import { AlertChannel } from '../domain/models/alert-dispatch.model';
import { RiskStatus } from '../domain/models/station-telemetry.model';

export interface AlertChannelMeta {
  label: string;
  icon: string;
  /** Latência nominal do canal em ms, antes do jitter determinístico. */
  baseLatencyMs: number;
  /** Fração da população exposta que o canal alcança. */
  coverage: number;
  /** Fração dos alcançados que confirma recebimento. */
  acknowledgeRate: number;
}

/**
 * Características operacionais de cada canal. A sirene é a mais rápida e a de
 * maior confirmação porque é audível, mas não carrega texto; o SMS é o mais
 * lento por depender da fila da operadora.
 */
export const ALERT_CHANNEL_META: Record<AlertChannel, AlertChannelMeta> = {
  SIREN: {
    label: 'Sirenes',
    icon: 'siren',
    baseLatencyMs: 350,
    coverage: 0.95,
    acknowledgeRate: 0.7,
  },
  PUSH: {
    label: 'Push PWA',
    icon: 'notifications_active',
    baseLatencyMs: 850,
    coverage: 0.42,
    acknowledgeRate: 0.31,
  },
  WHATSAPP: {
    label: 'WhatsApp',
    icon: 'chat',
    baseLatencyMs: 1600,
    coverage: 0.63,
    acknowledgeRate: 0.45,
  },
  SMS: {
    label: 'SMS',
    icon: 'sms',
    baseLatencyMs: 4200,
    coverage: 0.78,
    acknowledgeRate: 0.18,
  },
};

/**
 * Canais acionados por nível de severidade. A escalada é cumulativa: cada
 * nível mantém os canais do anterior e acrescenta alcance.
 */
export const EMERGENCY_CHANNEL_POLICY: Record<RiskStatus, readonly AlertChannel[]> = {
  NORMAL: [],
  ATENÇÃO: ['PUSH'],
  ALERTA: ['PUSH', 'WHATSAPP', 'SMS'],
  'ALERTA MÁXIMO': ['SIREN', 'PUSH', 'WHATSAPP', 'SMS'],
};

/** Severidade mínima que autoriza disparo à população. */
export const MIN_DISPATCH_STATUS: RiskStatus = 'ATENÇÃO';

/** Prefixo do protocolo de auditoria. */
export const DISPATCH_PROTOCOL_PREFIX = 'SGI';
