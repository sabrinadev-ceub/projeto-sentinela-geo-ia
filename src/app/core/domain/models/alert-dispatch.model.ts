import { RiskStatus, ShapValues } from './station-telemetry.model';

/** Canais de difusão previstos para alerta antecipado à população. */
export type AlertChannel = 'PUSH' | 'SMS' | 'WHATSAPP' | 'SIREN';

/**
 * Ciclo de vida de um canal dentro do disparo.
 *
 * `QUEUED_OFFLINE` existe porque o app é PWA offline-first: sem rede, o
 * disparo é registrado em LocalStorage e permanece auditável até sincronizar.
 */
export type ChannelDispatchStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'FAILED' | 'QUEUED_OFFLINE';

/** Quem acionou o disparo: a predição ou o operador de plantão. */
export type DispatchOrigin = 'AUTOMATIC' | 'MANUAL';

/** Estado de sincronização do registro local com a central. */
export type DispatchSyncState = 'SYNCED' | 'PENDING_SYNC';

/** Resultado de um canal isolado, com o tempo de resposta medido. */
export interface ChannelDispatch {
  channel: AlertChannel;
  status: ChannelDispatchStatus;
  /** Destinatários alcançados pelo canal, derivado da cobertura estimada. */
  recipients: number;
  /** Destinatários que confirmaram recebimento. */
  acknowledged: number;
  /** Tempo de resposta do canal em ms; `null` enquanto não houver resposta. */
  latencyMs: number | null;
  dispatchedAt: string | null;
  /** Motivo da falha quando `status` é `FAILED`. */
  error: string | null;
}

/**
 * Registro auditável de um alerta enviado. Nunca é alterado depois de
 * concluído: cada mudança de estado dos canais gera uma nova versão do mesmo
 * protocolo, e é esse histórico que sustenta a prestação de contas exigida
 * pelo PN-PDC.
 */
export interface AlertDispatch {
  id: string;
  /** Protocolo sequencial e legível (ex.: 'SGI-2026-000042'). */
  protocol: string;
  stationId: string;
  stationName: string;
  basinCode: string;
  /** Severidade que originou o disparo. */
  status: RiskStatus;
  riskScore: number;
  /** Cópia dos pesos SHAP no instante do disparo, para auditoria da decisão. */
  shapValues: ShapValues;
  /** Texto efetivamente difundido à população. */
  message: string;
  channels: ChannelDispatch[];
  /** População notificada, somando os destinatários sem repetição de canal. */
  populationNotified: number;
  /** Operador responsável pelo acionamento. */
  operator: string;
  triggeredBy: DispatchOrigin;
  createdAt: string;
  /** ISO-8601 do instante em que o último canal respondeu. */
  completedAt: string | null;
  /** Tempo de resposta total do disparo em ms: do registro ao último canal. */
  responseTimeMs: number | null;
  syncState: DispatchSyncState;
}
