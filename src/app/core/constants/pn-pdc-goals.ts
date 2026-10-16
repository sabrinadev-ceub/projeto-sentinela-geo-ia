/**
 * Indicadores nacionais da Meta 2.2.4 do PN-PDC 2025-2035, usados como
 * referência pelos KPIs da central.
 *
 * São números consolidados da rede nacional, não desta central: a central
 * contribui com as suas estações, mas a meta é medida no país inteiro. Por
 * isso ficam em constante e não são derivados da telemetria local.
 */
export const PN_PDC_GOAL = {
  code: '2.2.4',
  horizon: '2025-2035',
  monitoredMunicipalities: 1500,
  targetMunicipalities: 2500,
  /** Tempo médio entre a detecção e a difusão do alerta: 1m12s. */
  averageAlertLeadTimeMs: 72_000,
  /** Tempo máximo admitido pela meta entre a detecção e a difusão: 10 min. */
  targetAlertLeadTimeMs: 600_000,
} as const;

/** Tecnologia de enlace dos sensores de campo. */
export const SENSOR_NETWORK = 'LoRaWAN';
