import {
  RiskStatus,
  SensorReading,
  ShapValues,
  TelemetryVariable,
  VariableThreshold,
} from './station-telemetry.model';

/**
 * Contribuição individual de uma variável para a predição — é a carga de XAI
 * que a interface precisa para justificar o risco ao operador da Defesa Civil.
 */
export interface RiskDriver {
  variable: TelemetryVariable;
  label: string;
  shortLabel: string;
  unit: string;
  icon: string;
  /** Valor lido no sensor. */
  value: number;
  /** Severidade normalizada de 0 a 1 dentro dos limiares da estação. */
  severity: number;
  /** Status que a variável atingiria isoladamente. */
  status: RiskStatus;
  /** Peso SHAP em % — mesmo número publicado em `ShapValues`. */
  weight: number;
  thresholds: VariableThreshold;
}

/**
 * Resultado completo da predição. Imutável e derivado apenas de
 * `readings` + `thresholds`: a mesma entrada produz sempre a mesma saída.
 */
export interface RiskAssessment {
  /** Probabilidade de risco de 0 a 100. */
  riskScore: number;
  status: RiskStatus;
  shapValues: ShapValues;
  /** `drivers` ordenado do maior para o menor peso SHAP. */
  drivers: RiskDriver[];
  /**
   * Preenchido quando o status foi elevado por regra de protocolo (variável
   * acima do limiar máximo) em vez de pela faixa de pontuação. `null` quando
   * a pontuação por si só explica o status.
   */
  escalationReason: string | null;
  /** Variáveis que estouraram o limiar máximo. */
  criticalVariables: TelemetryVariable[];
  readings: SensorReading;
  evaluatedAt: string;
}
