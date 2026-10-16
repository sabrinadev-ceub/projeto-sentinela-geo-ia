import { Injectable } from '@angular/core';
import {
  COMPOUND_FACTORS,
  SCORE_BANDS,
  SEVERITY_BANDS,
  TELEMETRY_VARIABLES,
  TELEMETRY_VARIABLE_META,
  VARIABLE_WEIGHTS,
} from '../../constants/risk-thresholds';
import { RiskAssessment, RiskDriver } from '../models/risk-assessment.model';
import {
  RiskStatus,
  SensorReading,
  ShapValues,
  StationThresholds,
  StationTelemetry,
  TelemetryVariable,
  VariableThreshold,
  worstStatus,
} from '../models/station-telemetry.model';

/**
 * Calcula a probabilidade de risco hidrogeológico e distribui os pesos SHAP
 * que explicam a predição.
 *
 * O cálculo é determinístico e puro: nenhuma chamada a `Math.random()` ou a
 * `Date.now()` entra na pontuação (apenas o `evaluatedAt` do carimbo). A mesma
 * leitura com os mesmos limiares devolve sempre o mesmo resultado, o que é
 * requisito para auditoria de alerta e para teste de regressão.
 *
 * O pipeline tem quatro etapas:
 *
 * 1. **Normalização**: cada leitura vira uma severidade de 0 a 1 por
 *    interpolação linear entre os limiares físicos da estação.
 * 2. **Ponderação**: soma das severidades pelos pesos base do modelo, que
 *    somam 1.
 * 3. **Interação**: ganho superaditivo para as duas combinações que a
 *    hidrologia trata como deflagradoras: solo saturado com chuva intensa
 *    (enxurrada) e acumulado de 5 dias com encosta em movimento
 *    (deslizamento).
 * 4. **Escalada de protocolo**: variável acima do limiar máximo eleva o
 *    status independentemente da pontuação, porque a Defesa Civil não espera
 *    a média subir para evacuar uma encosta em ruptura.
 */
@Injectable({ providedIn: 'root' })
export class CalculateRiskXaiUseCase {
  execute(station: StationTelemetry): RiskAssessment {
    return this.evaluate(station.readings, station.thresholds);
  }

  evaluate(readings: SensorReading, thresholds: StationThresholds): RiskAssessment {
    const severities = this.normalize(readings, thresholds);
    const contributions = this.weigh(severities);
    const riskScore = this.score(severities, contributions);
    const shapValues = distributeShap(contributions);

    const criticalVariables = TELEMETRY_VARIABLES.filter(
      (variable) => severities[variable] >= SEVERITY_BANDS.maximum,
    );
    const alertVariables = TELEMETRY_VARIABLES.filter(
      (variable) => severities[variable] >= SEVERITY_BANDS.alert,
    );

    const scoreStatus = scoreToStatus(riskScore);
    const escalated = this.escalate(scoreStatus, criticalVariables, alertVariables);

    return {
      riskScore,
      status: escalated.status,
      shapValues,
      drivers: this.describe(readings, thresholds, severities, shapValues),
      escalationReason: escalated.reason,
      criticalVariables: [...criticalVariables],
      readings: { ...readings },
      evaluatedAt: new Date().toISOString(),
    };
  }

  /**
   * Converte cada leitura em severidade de 0 a 1. As faixas abaixo de
   * `attention` são lineares a partir de zero; as demais interpolam entre os
   * patamares, de modo que a severidade cresça mais rápido perto do limiar
   * crítico.
   */
  private normalize(
    readings: SensorReading,
    thresholds: StationThresholds,
  ): Record<TelemetryVariable, number> {
    const result = {} as Record<TelemetryVariable, number>;

    for (const variable of TELEMETRY_VARIABLES) {
      result[variable] = severityOf(readings[variable], thresholds[variable]);
    }
    return result;
  }

  private weigh(severities: Record<TelemetryVariable, number>): Record<TelemetryVariable, number> {
    const result = {} as Record<TelemetryVariable, number>;

    for (const variable of TELEMETRY_VARIABLES) {
      result[variable] = VARIABLE_WEIGHTS[variable] * severities[variable];
    }
    return result;
  }

  private score(
    severities: Record<TelemetryVariable, number>,
    contributions: Record<TelemetryVariable, number>,
  ): number {
    const base = TELEMETRY_VARIABLES.reduce((acc, v) => acc + contributions[v], 0);

    const runoff = severities.soilSaturation * severities.rainfall24h;
    const landslide = severities.accumulatedRainfall5d * severities.slopeDisplacement;
    const amplifier = 1 + COMPOUND_FACTORS.runoff * runoff + COMPOUND_FACTORS.landslide * landslide;

    return clamp(Math.round(base * amplifier * 100), 0, 100);
  }

  /**
   * Eleva o status quando o protocolo exige, devolvendo a justificativa que a
   * interface exibe junto do alerta.
   */
  private escalate(
    scoreStatus: RiskStatus,
    criticalVariables: readonly TelemetryVariable[],
    alertVariables: readonly TelemetryVariable[],
  ): { status: RiskStatus; reason: string | null } {
    if (criticalVariables.length >= 2) {
      const status = worstStatus(scoreStatus, 'ALERTA MÁXIMO');
      return {
        status,
        reason:
          status === scoreStatus
            ? null
            : `${criticalVariables.length} variáveis acima do limiar máximo: ${labelList(criticalVariables)}.`,
      };
    }

    if (criticalVariables.length === 1) {
      const status = worstStatus(scoreStatus, 'ALERTA');
      return {
        status,
        reason:
          status === scoreStatus ? null : `${labelList(criticalVariables)} acima do limiar máximo.`,
      };
    }

    if (alertVariables.length >= 3) {
      const status = worstStatus(scoreStatus, 'ALERTA');
      return {
        status,
        reason:
          status === scoreStatus
            ? null
            : `${alertVariables.length} variáveis na faixa de alerta: ${labelList(alertVariables)}.`,
      };
    }

    return { status: scoreStatus, reason: null };
  }

  private describe(
    readings: SensorReading,
    thresholds: StationThresholds,
    severities: Record<TelemetryVariable, number>,
    shapValues: ShapValues,
  ): RiskDriver[] {
    return TELEMETRY_VARIABLES.map<RiskDriver>((variable) => {
      const meta = TELEMETRY_VARIABLE_META[variable];

      return {
        variable,
        label: meta.label,
        shortLabel: meta.shortLabel,
        unit: meta.unit,
        icon: meta.icon,
        value: readings[variable],
        severity: round(severities[variable], 4),
        status: severityToStatus(severities[variable]),
        weight: shapValues[variable],
        thresholds: { ...thresholds[variable] },
      };
    }).sort((a, b) => b.weight - a.weight || b.severity - a.severity);
  }
}

/** Interpolação linear por patamar entre os limiares físicos da variável. */
export function severityOf(value: number, threshold: VariableThreshold): number {
  if (!Number.isFinite(value) || value <= 0) return 0;

  if (value < threshold.attention) {
    return (value / threshold.attention) * SEVERITY_BANDS.attention;
  }

  if (value < threshold.alert) {
    const span = threshold.alert - threshold.attention;
    const progress = (value - threshold.attention) / span;
    return SEVERITY_BANDS.attention + progress * (SEVERITY_BANDS.alert - SEVERITY_BANDS.attention);
  }

  if (value < threshold.maximum) {
    const span = threshold.maximum - threshold.alert;
    const progress = (value - threshold.alert) / span;
    return SEVERITY_BANDS.alert + progress * (SEVERITY_BANDS.maximum - SEVERITY_BANDS.alert);
  }

  return SEVERITY_BANDS.maximum;
}

export function severityToStatus(severity: number): RiskStatus {
  if (severity >= SEVERITY_BANDS.maximum) return 'ALERTA MÁXIMO';
  if (severity >= SEVERITY_BANDS.alert) return 'ALERTA';
  if (severity >= SEVERITY_BANDS.attention) return 'ATENÇÃO';
  return 'NORMAL';
}

export function scoreToStatus(score: number): RiskStatus {
  if (score >= SCORE_BANDS.maximum) return 'ALERTA MÁXIMO';
  if (score >= SCORE_BANDS.alert) return 'ALERTA';
  if (score >= SCORE_BANDS.attention) return 'ATENÇÃO';
  return 'NORMAL';
}

/**
 * Converte contribuições absolutas em percentuais inteiros que somam 100,
 * usando maiores restos: arredondar cada peso isoladamente produziria uma soma
 * de 99 ou 101 e um gráfico de XAI que não fecha.
 *
 * Sem contribuição alguma (estação em repouso) devolve a importância base do
 * modelo, que já é inteira e soma 100.
 */
export function distributeShap(contributions: Record<TelemetryVariable, number>): ShapValues {
  const total = TELEMETRY_VARIABLES.reduce((acc, v) => acc + contributions[v], 0);

  if (total <= 0) {
    const fallback = {} as ShapValues;
    for (const variable of TELEMETRY_VARIABLES) {
      fallback[variable] = Math.round(VARIABLE_WEIGHTS[variable] * 100);
    }
    return fallback;
  }

  const exact = TELEMETRY_VARIABLES.map((variable) => {
    const value = (contributions[variable] / total) * 100;
    return { variable, floor: Math.floor(value), remainder: value - Math.floor(value) };
  });

  const result = {} as ShapValues;
  for (const entry of exact) result[entry.variable] = entry.floor;

  let remaining = 100 - exact.reduce((acc, e) => acc + e.floor, 0);
  const byRemainder = [...exact].sort((a, b) => b.remainder - a.remainder);

  for (const entry of byRemainder) {
    if (remaining <= 0) break;
    result[entry.variable] += 1;
    remaining -= 1;
  }

  return result;
}

function labelList(variables: readonly TelemetryVariable[]): string {
  return variables.map((v) => TELEMETRY_VARIABLE_META[v].shortLabel).join(', ');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
