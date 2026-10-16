import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ALERT_CHANNEL_META } from '../../../../core/constants/emergency-channels';
import { AlertChannel } from '../../../../core/domain/models/alert-dispatch.model';
import { MODAL_DATA } from '../../../../shared/ui/modal/modal.model';
import { EmergencyBriefingData } from '../../../models/command-center.models';
import {
  CHANNEL_STATUS_META,
  ChannelStatusMeta,
  formatDecimal,
  formatDuration,
  formatInteger,
} from '../../formatters';

export interface BriefingChannelView {
  channel: AlertChannel;
  label: string;
  status: ChannelStatusMeta;
  latency: string;
  reach: string;
}

/**
 * Corpo da modal de emergência: difusão multicanal ao vivo e rota de
 * evacuação acionada.
 *
 * Não injeta serviço de negócio. Recebe por `MODAL_DATA` o que o Facade
 * montou, e o `Signal` de disparo dentro dele é o que faz cada canal mudar de
 * estado na frente do operador.
 */
@Component({
  selector: 'app-emergency-briefing',
  templateUrl: './emergency-briefing.component.html',
  styleUrl: './emergency-briefing.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmergencyBriefingComponent {
  protected readonly data = inject<EmergencyBriefingData>(MODAL_DATA);

  protected readonly dispatch = this.data.dispatch;

  protected readonly channels = computed<BriefingChannelView[]>(() => {
    const dispatch = this.dispatch();
    if (!dispatch) return [];

    return dispatch.channels.map((channel) => ({
      channel: channel.channel,
      label: ALERT_CHANNEL_META[channel.channel].label,
      status: CHANNEL_STATUS_META[channel.status],
      latency: channel.latencyMs === null ? '-' : formatDuration(channel.latencyMs),
      reach: `${formatInteger(channel.recipients)} pessoas`,
    }));
  });

  protected readonly progress = computed(() => {
    const dispatch = this.dispatch();
    if (!dispatch) return { done: 0, total: 0, complete: false };

    const done = dispatch.channels.filter(
      (channel) => channel.status !== 'PENDING' && channel.status !== 'QUEUED_OFFLINE',
    ).length;
    return { done, total: dispatch.channels.length, complete: dispatch.completedAt !== null };
  });

  protected readonly responseTime = computed(() => {
    const ms = this.dispatch()?.responseTimeMs ?? null;
    return ms === null ? null : formatDuration(ms);
  });

  protected readonly route = this.data.route;

  protected readonly routeFacts = this.route
    ? [
        { label: 'Distância', value: `${formatDecimal(this.route.distanceKm)} km` },
        { label: 'A pé', value: `${this.route.walkingMinutes} min` },
        { label: 'Capacidade', value: `${formatInteger(this.route.shelterCapacity)} pessoas` },
        { label: 'Cota', value: `${formatInteger(this.route.shelterAltitude)} m` },
      ]
    : [];
}
