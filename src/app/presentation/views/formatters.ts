import { AlertChannel, ChannelDispatchStatus } from '../../core/domain/models/alert-dispatch.model';

const LOCALE = 'pt-BR';

const integerFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const timeFormat = new Intl.DateTimeFormat(LOCALE, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const dateTimeFormat = new Intl.DateTimeFormat(LOCALE, {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export function formatInteger(value: number): string {
  return integerFormat.format(value);
}

export function formatDecimal(value: number, digits = 1): string {
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/** `ratio` de 0 a 1. */
export function formatPercent(ratio: number, digits = 1): string {
  return `${formatDecimal(ratio * 100, digits)}%`;
}

/**
 * Duração legível na escala certa: ms para latência de canal, segundos para
 * disparo e minutos para tempo de alerta, porque o operador compara ordens de
 * grandeza, não casas decimais.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${formatDecimal(ms / 1000)} s`;

  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes} min` : `${minutes}m${String(seconds).padStart(2, '0')}s`;
}

export function formatTime(iso: string | null): string {
  return iso ? timeFormat.format(new Date(iso)) : '-';
}

export function formatDateTime(iso: string | null): string {
  return iso ? dateTimeFormat.format(new Date(iso)) : '-';
}

/**
 * Leitura de sensor: inteiro quando não há fração e até `digits` casas quando
 * há, sem zero à direita: "131,8 mm" e "1,42 m", nunca "131,80 mm".
 */
export function formatReading(value: number, digits = 1): string {
  if (Number.isInteger(value)) return formatInteger(value);

  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: 1,
    maximumFractionDigits: digits,
  }).format(value);
}

/** Rótulos curtos de canal para chips de tabela e de modal. */
export const CHANNEL_SHORT_LABEL: Record<AlertChannel, string> = {
  PUSH: 'Push',
  SMS: 'SMS',
  WHATSAPP: 'WhatsApp',
  SIREN: 'Sirene',
};

export interface ChannelStatusMeta {
  label: string;
  tone: 'success' | 'info' | 'warning' | 'danger' | 'pending';
}

export const CHANNEL_STATUS_META: Record<ChannelDispatchStatus, ChannelStatusMeta> = {
  PENDING: { label: 'Em difusão', tone: 'pending' },
  SENT: { label: 'Enviado', tone: 'info' },
  DELIVERED: { label: 'Entregue', tone: 'success' },
  FAILED: { label: 'Falhou', tone: 'danger' },
  QUEUED_OFFLINE: { label: 'Fila offline', tone: 'warning' },
};
