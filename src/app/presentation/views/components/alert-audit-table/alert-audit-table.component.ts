import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ALERT_CHANNEL_META } from '../../../../core/constants/emergency-channels';
import {
  AlertChannel,
  AlertDispatch,
  ChannelDispatch,
} from '../../../../core/domain/models/alert-dispatch.model';
import { RiskStatus } from '../../../../core/domain/models/station-telemetry.model';
import {
  CHANNEL_SHORT_LABEL,
  CHANNEL_STATUS_META,
  ChannelStatusMeta,
  formatDateTime,
  formatDuration,
  formatInteger,
} from '../../formatters';

export type LatencyTone = 'fast' | 'normal' | 'slow' | 'pending' | 'offline';

export interface ChannelCellView {
  channel: AlertChannel;
  label: string;
  status: ChannelStatusMeta;
  latency: string | null;
  tooltip: string;
}

export interface AuditRowView {
  id: string;
  protocol: string;
  createdAt: string;
  stationName: string;
  basinCode: string;
  status: RiskStatus;
  riskScore: number;
  isManual: boolean;
  operator: string;
  channels: ChannelCellView[];
  latency: string;
  latencyTone: LatencyTone;
  population: string;
  isSynced: boolean;
}

/**
 * Faixas da latência total do disparo. A sirene responde em centenas de ms e
 * o SMS em segundos: acima de 5 s a difusão já depende da fila da operadora.
 */
const LATENCY_BANDS_MS = { fast: 2000, normal: 5000 } as const;

export const AUDIT_COLUMNS = [
  'protocol',
  'station',
  'severity',
  'origin',
  'channels',
  'latency',
  'population',
  'sync',
] as const;

/**
 * Trilha de auditoria dos disparos à população. Componente puro: recebe o
 * histórico já ordenado e só o projeta em linhas de tabela.
 */
@Component({
  selector: 'app-alert-audit-table',
  imports: [MatTableModule, MatTooltipModule],
  templateUrl: './alert-audit-table.component.html',
  styleUrl: './alert-audit-table.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlertAuditTableComponent {
  readonly dispatches = input.required<AlertDispatch[]>();

  protected readonly columns = AUDIT_COLUMNS;

  protected readonly rows = computed<AuditRowView[]>(() => this.dispatches().map(toRow));

  protected readonly summary = computed(() => {
    const dispatches = this.dispatches();
    return {
      total: dispatches.length,
      manual: dispatches.filter((dispatch) => dispatch.triggeredBy === 'MANUAL').length,
      pendingSync: dispatches.filter((dispatch) => dispatch.syncState === 'PENDING_SYNC').length,
    };
  });

  protected readonly trackById = (_: number, row: AuditRowView): string => row.id;
}

function toRow(dispatch: AlertDispatch): AuditRowView {
  const latency = latencyOf(dispatch);

  return {
    id: dispatch.id,
    protocol: dispatch.protocol,
    createdAt: formatDateTime(dispatch.createdAt),
    stationName: dispatch.stationName,
    basinCode: dispatch.basinCode,
    status: dispatch.status,
    riskScore: dispatch.riskScore,
    isManual: dispatch.triggeredBy === 'MANUAL',
    operator: dispatch.operator,
    channels: dispatch.channels.map(toChannelCell),
    latency: latency.label,
    latencyTone: latency.tone,
    population: formatInteger(dispatch.populationNotified),
    isSynced: dispatch.syncState === 'SYNCED',
  };
}

function toChannelCell(channel: ChannelDispatch): ChannelCellView {
  const status = CHANNEL_STATUS_META[channel.status];
  const latency = channel.latencyMs === null ? null : formatDuration(channel.latencyMs);

  const parts = [`${ALERT_CHANNEL_META[channel.channel].label}: ${status.label}`];
  if (latency) parts.push(`latência ${latency}`);
  if (channel.status === 'DELIVERED' || channel.status === 'SENT') {
    parts.push(
      `${formatInteger(channel.acknowledged)} de ${formatInteger(channel.recipients)} confirmaram`,
    );
  }
  if (channel.error) parts.push(channel.error);

  return {
    channel: channel.channel,
    label: CHANNEL_SHORT_LABEL[channel.channel],
    status,
    latency,
    tooltip: parts.join(' · '),
  };
}

function latencyOf(dispatch: AlertDispatch): { label: string; tone: LatencyTone } {
  if (dispatch.syncState === 'PENDING_SYNC') return { label: 'Fila offline', tone: 'offline' };
  if (dispatch.responseTimeMs === null) return { label: 'Em difusão', tone: 'pending' };

  const ms = dispatch.responseTimeMs;
  const tone: LatencyTone =
    ms <= LATENCY_BANDS_MS.fast ? 'fast' : ms <= LATENCY_BANDS_MS.normal ? 'normal' : 'slow';
  return { label: formatDuration(ms), tone };
}
