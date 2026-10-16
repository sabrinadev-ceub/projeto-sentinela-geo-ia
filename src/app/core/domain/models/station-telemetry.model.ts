/**
 * Variáveis físicas monitoradas por estação, conforme a Meta 2.2.4 do PN-PDC
 * 2025-2035 e os limiares de deflagração usados por INPE/CEMADEN.
 *
 * As chaves são a identidade canônica de cada variável: `SensorReading`,
 * `StationThresholds` e `ShapValues` são todos indexados por elas, de modo que
 * incluir um sensor novo quebra a compilação em todos os pontos que precisam
 * tratá-lo.
 */
export type TelemetryVariable =
  'rainfall24h' | 'accumulatedRainfall5d' | 'riverLevel' | 'soilSaturation' | 'slopeDisplacement';

/** Níveis operacionais da Defesa Civil. A ordem do array abaixo é a de severidade. */
export type RiskStatus = 'NORMAL' | 'ATENÇÃO' | 'ALERTA' | 'ALERTA MÁXIMO';

export const RISK_STATUS_ORDER: readonly RiskStatus[] = [
  'NORMAL',
  'ATENÇÃO',
  'ALERTA',
  'ALERTA MÁXIMO',
];

/** Direção da variação do risco entre duas leituras consecutivas do streaming. */
export type RiskTrend = 'RISING' | 'STABLE' | 'FALLING';

/** Peso percentual (0-100) de cada variável na predição. Soma exatamente 100. */
export type ShapValues = Record<TelemetryVariable, number>;

/** Leitura instantânea dos sensores IoT da estação. */
export interface SensorReading {
  /** Pluviometria das últimas 24 horas, em mm. */
  rainfall24h: number;
  /** Chuva acumulada em 5 dias, em mm. Gatilho de deslizamento do INPE. */
  accumulatedRainfall5d: number;
  /** Cota do rio na régua da estação, em metros. */
  riverLevel: number;
  /** Saturação do solo, em % do volume de poros. */
  soilSaturation: number;
  /** Deslocamento do inclinômetro nas últimas 24 horas, em mm. */
  slopeDisplacement: number;
}

/**
 * Limiares físicos de uma variável. São crescentes
 * (`attention < alert < maximum`) e definem as faixas usadas para normalizar
 * a leitura em severidade.
 */
export interface VariableThreshold {
  attention: number;
  alert: number;
  maximum: number;
}

/** Limiares completos de uma estação: globais por variável, cota do rio por régua local. */
export type StationThresholds = Record<TelemetryVariable, VariableThreshold>;

/** Bacia hidrográfica da Divisão Hidrográfica Nacional referenciada no PN-PDC. */
export interface HydroBasin {
  /** Código da bacia na DHN (ex.: '62' para Taquari-Antas). */
  code: string;
  name: string;
  state: string;
  region: string;
}

export interface GeoPosition {
  latitude: number;
  longitude: number;
  /** Altitude em metros, usada para contextualizar risco de encosta. */
  altitude: number;
}

/**
 * Entidade de telemetria de uma estação. Carrega a leitura bruta dos sensores
 * e o resultado já materializado da predição (`status`, `riskScore`,
 * `shapValues`), de forma que qualquer consumidor renderize a estação sem
 * recalcular nada.
 */
export interface StationTelemetry {
  id: string;
  name: string;
  city: string;
  basin: HydroBasin;
  position: GeoPosition;
  /** População em área de risco coberta pela estação. */
  exposedPopulation: number;
  thresholds: StationThresholds;
  readings: SensorReading;
  status: RiskStatus;
  /** Probabilidade de risco de 0 a 100. */
  riskScore: number;
  shapValues: ShapValues;
  trend: RiskTrend;
  /** ISO-8601 do instante da leitura. */
  measuredAt: string;
  /** `false` quando o enlace do sensor cai: a UI passa a exibir dado defasado. */
  isOnline: boolean;
}

/** Comparador de severidade: devolve o mais grave entre dois status. */
export function worstStatus(a: RiskStatus, b: RiskStatus): RiskStatus {
  return RISK_STATUS_ORDER.indexOf(a) >= RISK_STATUS_ORDER.indexOf(b) ? a : b;
}
