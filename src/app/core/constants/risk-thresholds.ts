import {
  StationThresholds,
  TelemetryVariable,
  VariableThreshold,
} from '../domain/models/station-telemetry.model';

/** Ordem canônica de iteração das variáveis — fixa a ordem dos pesos SHAP. */
export const TELEMETRY_VARIABLES: readonly TelemetryVariable[] = [
  'accumulatedRainfall5d',
  'rainfall24h',
  'riverLevel',
  'soilSaturation',
  'slopeDisplacement',
];

export interface TelemetryVariableMeta {
  label: string;
  shortLabel: string;
  unit: string;
  icon: string;
  description: string;
}

/** Rótulos e unidades de apresentação de cada sensor. */
export const TELEMETRY_VARIABLE_META: Record<TelemetryVariable, TelemetryVariableMeta> = {
  accumulatedRainfall5d: {
    label: 'Chuva acumulada em 5 dias',
    shortLabel: 'Acumulado 5d',
    unit: 'mm',
    icon: 'rainy',
    description:
      'Gatilho de deslizamento do INPE: solo encharcado por chuva prolongada perde coesão.',
  },
  rainfall24h: {
    label: 'Pluviometria 24h',
    shortLabel: 'Chuva 24h',
    unit: 'mm',
    icon: 'water_drop',
    description: 'Intensidade recente da precipitação, responsável por enxurradas rápidas.',
  },
  riverLevel: {
    label: 'Nível do rio',
    shortLabel: 'Cota do rio',
    unit: 'm',
    icon: 'water',
    description: 'Cota medida na régua da estação, comparada à cota de inundação local.',
  },
  soilSaturation: {
    label: 'Saturação do solo',
    shortLabel: 'Solo',
    unit: '%',
    icon: 'humidity_percentage',
    description: 'Fração dos poros ocupada por água: define quanta chuva ainda pode infiltrar.',
  },
  slopeDisplacement: {
    label: 'Deslocamento de encosta',
    shortLabel: 'Inclinômetro',
    unit: 'mm/24h',
    icon: 'landslide',
    description: 'Movimentação do inclinômetro; aceleração indica ruptura iminente do talude.',
  },
};

/**
 * Limiares físicos de referência. `riverLevel` é apenas um fallback: cada
 * estação sobrescreve a cota com a régua da sua própria bacia.
 */
export const DEFAULT_RISK_THRESHOLDS: StationThresholds = {
  accumulatedRainfall5d: { attention: 80, alert: 150, maximum: 250 },
  rainfall24h: { attention: 40, alert: 80, maximum: 120 },
  riverLevel: { attention: 3, alert: 4.5, maximum: 6 },
  soilSaturation: { attention: 70, alert: 85, maximum: 95 },
  slopeDisplacement: { attention: 2, alert: 10, maximum: 30 },
};

/**
 * Importância base de cada variável no modelo. Soma exatamente 1 — é o que
 * garante que a pontuação ponderada caiba na escala de 0 a 100 sem reescala.
 */
export const VARIABLE_WEIGHTS: Record<TelemetryVariable, number> = {
  accumulatedRainfall5d: 0.28,
  rainfall24h: 0.24,
  riverLevel: 0.22,
  soilSaturation: 0.16,
  slopeDisplacement: 0.1,
};

/** Severidade normalizada atribuída a cada limiar atingido. */
export const SEVERITY_BANDS = {
  attention: 0.4,
  alert: 0.7,
  maximum: 1,
} as const;

/** Faixas de pontuação que traduzem o risco em status operacional. */
export const SCORE_BANDS = {
  attention: 30,
  alert: 60,
  maximum: 85,
} as const;

/**
 * Ganho máximo dos termos de interação. Solo saturado + chuva intensa (e
 * acumulado + encosta em movimento) produzem risco superaditivo: o efeito
 * conjunto é maior que a soma dos efeitos isolados.
 */
export const COMPOUND_FACTORS = {
  runoff: 0.12,
  landslide: 0.12,
} as const;

/** Clona os limiares de referência aplicando sobrescritas por estação. */
export function buildStationThresholds(
  overrides: Partial<Record<TelemetryVariable, VariableThreshold>> = {},
): StationThresholds {
  return {
    accumulatedRainfall5d: overrides.accumulatedRainfall5d ?? {
      ...DEFAULT_RISK_THRESHOLDS.accumulatedRainfall5d,
    },
    rainfall24h: overrides.rainfall24h ?? { ...DEFAULT_RISK_THRESHOLDS.rainfall24h },
    riverLevel: overrides.riverLevel ?? { ...DEFAULT_RISK_THRESHOLDS.riverLevel },
    soilSaturation: overrides.soilSaturation ?? { ...DEFAULT_RISK_THRESHOLDS.soilSaturation },
    slopeDisplacement: overrides.slopeDisplacement ?? {
      ...DEFAULT_RISK_THRESHOLDS.slopeDisplacement,
    },
  };
}
