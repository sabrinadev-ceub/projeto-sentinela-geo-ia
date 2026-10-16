import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CommandCenterKpis } from '../../../models/command-center.models';
import { formatDuration, formatInteger, formatPercent } from '../../formatters';

export type KpiTone = 'primary' | 'success' | 'warning' | 'danger' | 'neutral';

export interface KpiCardView {
  id: string;
  label: string;
  value: string;
  /** Complemento ao lado do valor, como o denominador da meta. */
  suffix: string;
  caption: string;
  /** Preenchimento da barra de 0 a 1. */
  progress: number;
  /** Rótulo acessível da barra, que não pode depender só da cor. */
  progressLabel: string;
  tone: KpiTone;
}

/** Faixas da taxa de entrega: abaixo de 80% o alerta deixa de alcançar a população. */
const DELIVERY_BANDS = { good: 0.95, acceptable: 0.8 } as const;

/**
 * Faixa de KPIs da Meta 2.2.4. Fica no fim da tela: são indicadores do
 * programa, acompanhados ao longo de meses, e não devem disputar atenção com
 * a estação em risco agora.
 *
 * Componente puro: recebe os números crus do Facade e decide apenas como
 * apresentá-los.
 */
@Component({
  selector: 'app-kpi-summary-bar',
  templateUrl: './kpi-summary-bar.component.html',
  styleUrl: './kpi-summary-bar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KpiSummaryBarComponent {
  readonly kpis = input.required<CommandCenterKpis>();

  protected readonly cards = computed<KpiCardView[]>(() => {
    const { municipalities, sensors, alertLeadTime, delivery } = this.kpis();

    return [
      municipalityCard(municipalities),
      sensorCard(sensors),
      leadTimeCard(alertLeadTime),
      deliveryCard(delivery),
    ];
  });
}

function municipalityCard(data: CommandCenterKpis['municipalities']): KpiCardView {
  const progress = ratio(data.monitored, data.target);

  return {
    id: 'municipalities',
    label: 'Municípios monitorados',
    value: formatInteger(data.monitored),
    suffix: `/ ${formatInteger(data.target)}`,
    caption: `${formatPercent(progress, 0)} da Meta ${data.goalCode} · PN-PDC ${data.horizon}`,
    progress,
    progressLabel: `${formatPercent(progress, 0)} da meta de municípios`,
    tone: 'primary',
  };
}

function sensorCard(data: CommandCenterKpis['sensors']): KpiCardView {
  const progress = ratio(data.online, data.total);
  const tone: KpiTone = progress >= 1 ? 'success' : progress >= 0.5 ? 'warning' : 'danger';

  return {
    id: 'sensors',
    label: `Sensores IoT ${data.network} online`,
    value: formatInteger(data.online),
    suffix: `/ ${formatInteger(data.total)}`,
    caption: `${data.stationsOnline} de ${data.stationsTotal} estações com enlace ativo`,
    progress,
    progressLabel: `${formatPercent(progress, 0)} dos sensores online`,
    tone,
  };
}

/**
 * Tempo de alerta é "quanto menor, melhor": a barra mostra a fração da meta
 * consumida, então uma barra curta é o resultado bom.
 */
function leadTimeCard(data: CommandCenterKpis['alertLeadTime']): KpiCardView {
  const consumed = ratio(data.averageMs, data.targetMs);
  const tone: KpiTone = consumed <= 0.5 ? 'success' : consumed <= 1 ? 'warning' : 'danger';
  const margin = formatPercent(Math.max(0, 1 - consumed), 0);
  const last =
    data.lastDispatchMs === null
      ? 'sem disparo nesta central'
      : `último disparo em ${formatDuration(data.lastDispatchMs)}`;

  return {
    id: 'lead-time',
    label: 'Tempo médio de alerta',
    value: formatDuration(data.averageMs),
    suffix: `meta ≤ ${formatDuration(data.targetMs)}`,
    caption: `${margin} abaixo da meta · ${last}`,
    progress: consumed,
    progressLabel: `${formatPercent(consumed, 0)} do tempo máximo da meta consumido`,
    tone,
  };
}

function deliveryCard(data: CommandCenterKpis['delivery']): KpiCardView {
  if (data.rate === null) {
    return {
      id: 'delivery',
      label: 'Taxa de entrega multicanal',
      value: '-',
      suffix: '',
      caption: 'Nenhum canal concluído até agora',
      progress: 0,
      progressLabel: 'Sem dados de entrega',
      tone: 'neutral',
    };
  }

  const tone: KpiTone =
    data.rate >= DELIVERY_BANDS.good
      ? 'success'
      : data.rate >= DELIVERY_BANDS.acceptable
        ? 'warning'
        : 'danger';

  return {
    id: 'delivery',
    label: 'Taxa de entrega multicanal',
    value: formatPercent(data.rate),
    suffix: '',
    caption:
      `${data.delivered} de ${data.attempted} canais entregues · ` +
      `${formatInteger(data.acknowledged)} confirmações de ${formatInteger(data.recipients)}`,
    progress: data.rate,
    progressLabel: `${formatPercent(data.rate)} de entrega`,
    tone,
  };
}

function ratio(value: number, total: number): number {
  return total > 0 ? Math.min(1, Math.max(0, value / total)) : 0;
}
