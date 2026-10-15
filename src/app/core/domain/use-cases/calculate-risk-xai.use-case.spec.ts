import { DEFAULT_RISK_THRESHOLDS, TELEMETRY_VARIABLES } from '../../constants/risk-thresholds';
import { SensorReading } from '../models/station-telemetry.model';
import { CalculateRiskXaiUseCase, severityOf } from './calculate-risk-xai.use-case';

const QUIET: SensorReading = {
  rainfall24h: 0,
  accumulatedRainfall5d: 0,
  riverLevel: 0,
  soilSaturation: 0,
  slopeDisplacement: 0,
};

const STORM: SensorReading = {
  rainfall24h: 168,
  accumulatedRainfall5d: 412,
  riverLevel: 7.2,
  soilSaturation: 98,
  slopeDisplacement: 44,
};

function sumShap(values: Record<string, number>): number {
  return Object.values(values).reduce((acc, value) => acc + value, 0);
}

describe('CalculateRiskXaiUseCase', () => {
  let useCase: CalculateRiskXaiUseCase;

  beforeEach(() => {
    useCase = new CalculateRiskXaiUseCase();
  });

  it('mantém a pontuação dentro de 0 a 100', () => {
    expect(useCase.evaluate(QUIET, DEFAULT_RISK_THRESHOLDS).riskScore).toBe(0);
    expect(useCase.evaluate(STORM, DEFAULT_RISK_THRESHOLDS).riskScore).toBe(100);
  });

  it('é determinístico para a mesma leitura', () => {
    const first = useCase.evaluate(STORM, DEFAULT_RISK_THRESHOLDS);
    const second = useCase.evaluate(STORM, DEFAULT_RISK_THRESHOLDS);

    expect(second.riskScore).toBe(first.riskScore);
    expect(second.status).toBe(first.status);
    expect(second.shapValues).toEqual(first.shapValues);
  });

  it('distribui pesos SHAP que somam exatamente 100', () => {
    const readings: SensorReading = {
      rainfall24h: 53,
      accumulatedRainfall5d: 137,
      riverLevel: 3.9,
      soilSaturation: 81,
      slopeDisplacement: 4.6,
    };

    expect(sumShap(useCase.evaluate(readings, DEFAULT_RISK_THRESHOLDS).shapValues)).toBe(100);
    expect(sumShap(useCase.evaluate(QUIET, DEFAULT_RISK_THRESHOLDS).shapValues)).toBe(100);
    expect(sumShap(useCase.evaluate(STORM, DEFAULT_RISK_THRESHOLDS).shapValues)).toBe(100);
  });

  it('classifica estação em repouso como NORMAL', () => {
    const assessment = useCase.evaluate(QUIET, DEFAULT_RISK_THRESHOLDS);

    expect(assessment.status).toBe('NORMAL');
    expect(assessment.criticalVariables).toEqual([]);
    expect(assessment.escalationReason).toBeNull();
  });

  it('classifica tempestade extrema como ALERTA MÁXIMO', () => {
    const assessment = useCase.evaluate(STORM, DEFAULT_RISK_THRESHOLDS);

    expect(assessment.status).toBe('ALERTA MÁXIMO');
    expect(assessment.criticalVariables.length).toBe(TELEMETRY_VARIABLES.length);
  });

  it('eleva o status quando uma única variável estoura o limiar máximo', () => {
    const assessment = useCase.evaluate(
      { ...QUIET, slopeDisplacement: 44 },
      DEFAULT_RISK_THRESHOLDS,
    );

    expect(assessment.riskScore).toBeLessThan(30);
    expect(assessment.status).toBe('ALERTA');
    expect(assessment.criticalVariables).toEqual(['slopeDisplacement']);
    expect(assessment.escalationReason).not.toBeNull();
  });

  it('ordena os drivers do maior para o menor peso', () => {
    const { drivers } = useCase.evaluate(
      {
        rainfall24h: 12,
        accumulatedRainfall5d: 210,
        riverLevel: 1,
        soilSaturation: 30,
        slopeDisplacement: 0.5,
      },
      DEFAULT_RISK_THRESHOLDS,
    );

    expect(drivers[0].variable).toBe('accumulatedRainfall5d');
    for (let i = 1; i < drivers.length; i++) {
      expect(drivers[i - 1].weight).toBeGreaterThanOrEqual(drivers[i].weight);
    }
  });

  it('aplica ganho superaditivo às combinações deflagradoras', () => {
    const isolated = useCase.evaluate(
      { ...QUIET, rainfall24h: 80, soilSaturation: 0 },
      DEFAULT_RISK_THRESHOLDS,
    ).riskScore;
    const combined = useCase.evaluate(
      { ...QUIET, rainfall24h: 80, soilSaturation: 85 },
      DEFAULT_RISK_THRESHOLDS,
    ).riskScore;
    const additive =
      isolated +
      useCase.evaluate({ ...QUIET, soilSaturation: 85 }, DEFAULT_RISK_THRESHOLDS).riskScore;

    expect(combined).toBeGreaterThan(additive);
  });
});

describe('severityOf', () => {
  const threshold = DEFAULT_RISK_THRESHOLDS.rainfall24h;

  it('devolve 0 para leitura nula ou negativa', () => {
    expect(severityOf(0, threshold)).toBe(0);
    expect(severityOf(-5, threshold)).toBe(0);
  });

  it('satura em 1 acima do limiar máximo', () => {
    expect(severityOf(threshold.maximum, threshold)).toBe(1);
    expect(severityOf(threshold.maximum * 4, threshold)).toBe(1);
  });

  it('é monotônica crescente', () => {
    let previous = 0;

    for (let value = 0; value <= threshold.maximum; value += 5) {
      const current = severityOf(value, threshold);
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });

  it('ancora cada patamar na sua faixa de severidade', () => {
    expect(severityOf(threshold.attention, threshold)).toBeCloseTo(0.4, 5);
    expect(severityOf(threshold.alert, threshold)).toBeCloseTo(0.7, 5);
  });
});
