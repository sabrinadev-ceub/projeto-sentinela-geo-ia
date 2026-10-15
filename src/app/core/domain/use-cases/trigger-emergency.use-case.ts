import { Injectable, inject } from '@angular/core';
import {
  ALERT_CHANNEL_META,
  DISPATCH_PROTOCOL_PREFIX,
  EMERGENCY_CHANNEL_POLICY,
  MIN_DISPATCH_STATUS,
} from '../../constants/emergency-channels';
import {
  AlertChannel,
  AlertDispatch,
  ChannelDispatch,
  DispatchOrigin,
} from '../models/alert-dispatch.model';
import { RiskAssessment, RiskDriver } from '../models/risk-assessment.model';
import { RISK_STATUS_ORDER, RiskStatus, StationTelemetry } from '../models/station-telemetry.model';
import { TelemetryRepository } from '../repositories/telemetry.repository';

export interface TriggerEmergencyInput {
  station: StationTelemetry;
  assessment: RiskAssessment;
  /** Operador responsável pelo acionamento, registrado na auditoria. */
  operator: string;
  triggeredBy?: DispatchOrigin;
  /** Sobrescreve o texto gerado automaticamente. */
  message?: string;
}

/**
 * Orquestra o disparo de alerta antecipado à população.
 *
 * O registro de auditoria é persistido **antes** de qualquer espera: se a aba
 * fechar no meio da difusão, o protocolo já está em LocalStorage com os canais
 * em `PENDING`, e não se perde o rastro de que o alerta foi acionado.
 *
 * Sem rede o disparo não falha — os canais entram em `QUEUED_OFFLINE` e o
 * registro fica `PENDING_SYNC`, que é o comportamento esperado de um PWA
 * offline-first operando em área de desastre.
 */
@Injectable({ providedIn: 'root' })
export class TriggerEmergencyUseCase {
  private readonly repository = inject(TelemetryRepository);

  /** `false` para status abaixo da severidade mínima de difusão. */
  canTrigger(status: RiskStatus): boolean {
    return RISK_STATUS_ORDER.indexOf(status) >= RISK_STATUS_ORDER.indexOf(MIN_DISPATCH_STATUS);
  }

  channelsFor(status: RiskStatus): readonly AlertChannel[] {
    return EMERGENCY_CHANNEL_POLICY[status];
  }

  /**
   * Registra e difunde o alerta. Resolve quando o último canal responde, mas o
   * repositório já reflete cada mudança de estado intermediária.
   */
  async execute(input: TriggerEmergencyInput): Promise<AlertDispatch> {
    const { station, assessment, operator } = input;

    if (!this.canTrigger(assessment.status)) {
      throw new Error(
        `Status "${assessment.status}" está abaixo da severidade mínima de difusão (${MIN_DISPATCH_STATUS}).`,
      );
    }

    const offline = isOffline();
    const channels = this.channelsFor(assessment.status);
    const protocol = this.buildProtocol();
    const createdAt = new Date().toISOString();

    const dispatch: AlertDispatch = {
      id: crypto.randomUUID(),
      protocol,
      stationId: station.id,
      stationName: station.name,
      basinCode: station.basin.code,
      status: assessment.status,
      riskScore: assessment.riskScore,
      shapValues: { ...assessment.shapValues },
      message: input.message ?? buildMessage(station, assessment),
      channels: channels.map((channel) =>
        this.seedChannel(channel, station.exposedPopulation, offline),
      ),
      populationNotified: offline ? 0 : reachOf(channels, station.exposedPopulation),
      operator,
      triggeredBy: input.triggeredBy ?? 'AUTOMATIC',
      createdAt,
      completedAt: null,
      responseTimeMs: null,
      syncState: offline ? 'PENDING_SYNC' : 'SYNCED',
    };

    this.repository.saveDispatch(dispatch);

    if (offline) return dispatch;

    const settled = await Promise.all(
      dispatch.channels.map((channel) => this.settle(channel, protocol)),
    );

    const responseTimeMs = settled.reduce((acc, c) => Math.max(acc, c.latencyMs ?? 0), 0);
    const completed: Partial<AlertDispatch> = {
      channels: settled,
      populationNotified: settled
        .filter((c) => c.status !== 'FAILED')
        .reduce((acc, c) => Math.max(acc, c.recipients), 0),
      completedAt: new Date(Date.parse(createdAt) + responseTimeMs).toISOString(),
      responseTimeMs,
    };

    this.repository.updateDispatch(dispatch.id, completed);
    return { ...dispatch, ...completed };
  }

  private buildProtocol(): string {
    const year = new Date().getFullYear();
    const sequence = String(this.repository.nextProtocolSequence()).padStart(6, '0');
    return `${DISPATCH_PROTOCOL_PREFIX}-${year}-${sequence}`;
  }

  private seedChannel(
    channel: AlertChannel,
    exposedPopulation: number,
    offline: boolean,
  ): ChannelDispatch {
    return {
      channel,
      status: offline ? 'QUEUED_OFFLINE' : 'PENDING',
      recipients: Math.round(exposedPopulation * ALERT_CHANNEL_META[channel].coverage),
      acknowledged: 0,
      latencyMs: null,
      dispatchedAt: null,
      error: null,
    };
  }

  /**
   * Simula a resposta do canal. A latência varia por `jitter` derivado do
   * protocolo, e não de `Math.random()`: o mesmo protocolo reproduz a mesma
   * difusão, o que mantém o histórico auditável reproduzível em teste.
   */
  private async settle(channel: ChannelDispatch, protocol: string): Promise<ChannelDispatch> {
    const meta = ALERT_CHANNEL_META[channel.channel];
    const jitter = hashRatio(`${protocol}:${channel.channel}`);
    const latencyMs = Math.round(meta.baseLatencyMs * (0.8 + jitter * 0.5));

    await delay(latencyMs);

    if (jitter < 0.05) {
      return {
        ...channel,
        status: 'FAILED',
        acknowledged: 0,
        latencyMs,
        dispatchedAt: new Date().toISOString(),
        error: 'Gateway do canal não confirmou a entrega.',
      };
    }

    return {
      ...channel,
      status: jitter > 0.85 ? 'SENT' : 'DELIVERED',
      acknowledged: Math.round(channel.recipients * meta.acknowledgeRate),
      latencyMs,
      dispatchedAt: new Date().toISOString(),
      error: null,
    };
  }
}

/**
 * Monta o texto difundido a partir dos dois maiores drivers da predição: o
 * alerta precisa dizer *por que* está sendo emitido para que a população aja.
 */
export function buildMessage(station: StationTelemetry, assessment: RiskAssessment): string {
  const [first, second] = assessment.drivers;
  const cause = [first, second]
    .filter((driver): driver is RiskDriver => driver !== undefined)
    .map((driver) => `${driver.label.toLowerCase()} em ${formatValue(driver.value)} ${driver.unit}`)
    .join(' e ');

  const action =
    assessment.status === 'ALERTA MÁXIMO'
      ? 'Evacue imediatamente para o ponto de apoio mais próximo.'
      : assessment.status === 'ALERTA'
        ? 'Prepare-se para deixar a área de risco e siga as orientações da Defesa Civil.'
        : 'Mantenha-se atento e evite encostas e margens de rio.';

  return (
    `${assessment.status} — Bacia ${station.basin.code} (${station.basin.name}/${station.basin.state}): ` +
    `risco de ${assessment.riskScore}% em ${station.name}, ${station.city}. ` +
    `Motivo: ${cause}. ${action}`
  );
}

/** Alcance do disparo: o maior alcance individual, sem somar canais sobrepostos. */
function reachOf(channels: readonly AlertChannel[], exposedPopulation: number): number {
  return channels.reduce(
    (acc, channel) =>
      Math.max(acc, Math.round(exposedPopulation * ALERT_CHANNEL_META[channel].coverage)),
    0,
  );
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** FNV-1a normalizado em [0, 1): jitter estável para a mesma string. */
function hashRatio(seed: string): number {
  let hash = 0x811c9dc5;

  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash / 0x100000000;
}

function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace('.', ',');
}
