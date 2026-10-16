import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RiskStatus } from '../../../../core/domain/models/station-telemetry.model';
import { WatchEvent, WatchEventKind } from '../../../models/command-center.models';
import { formatTime } from '../../formatters';

export interface WatchEntryView {
  id: string;
  time: string;
  kind: WatchEventKind;
  kindLabel: string;
  stationName: string;
  status: RiskStatus;
  description: string;
}

const KIND_LABEL: Record<WatchEventKind, string> = {
  STATUS_CHANGE: 'Nível',
  DISPATCH: 'Disparo',
};

/**
 * Diário de vigilância do turno: cada mudança de nível e cada disparo, com a
 * hora em que aconteceu. É o registro que o plantão consulta para saber o que
 * mudou enquanto olhava para outra estação.
 */
@Component({
  selector: 'app-watch-log',
  templateUrl: './watch-log.component.html',
  styleUrl: './watch-log.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WatchLogComponent {
  readonly events = input.required<WatchEvent[]>();

  protected readonly entries = computed<WatchEntryView[]>(() =>
    this.events().map((event) => ({
      id: event.id,
      time: formatTime(event.at),
      kind: event.kind,
      kindLabel: KIND_LABEL[event.kind],
      stationName: event.stationName,
      status: event.status,
      description: event.description,
    })),
  );
}
