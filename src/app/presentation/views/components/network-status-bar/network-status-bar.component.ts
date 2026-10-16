import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
  RISK_STATUS_ORDER,
  RiskStatus,
  StationTelemetry,
  worstStatus,
} from '../../../../core/domain/models/station-telemetry.model';

export interface NetworkConditionView {
  status: RiskStatus;
  headline: string;
  guidance: string;
  counts: { status: RiskStatus; count: number }[];
}

/** Conduta recomendada por nível, na linguagem do protocolo de Defesa Civil. */
const GUIDANCE: Record<RiskStatus, string> = {
  NORMAL: 'Nenhuma estação exige ação.',
  ATENÇÃO: 'Acompanhar a evolução das leituras.',
  ALERTA: 'Preparar a população para deixar as áreas de risco.',
  'ALERTA MÁXIMO': 'Evacuação imediata das áreas de risco.',
};

/**
 * Condição da rede em uma linha: o nível mais grave entre as estações, onde
 * ele está e o que o protocolo manda fazer. Em condição normal a faixa fica
 * neutra; acima disso ganha o tom do nível, para ser a primeira coisa vista.
 */
@Component({
  selector: 'app-network-status-bar',
  templateUrl: './network-status-bar.component.html',
  styleUrl: './network-status-bar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NetworkStatusBarComponent {
  readonly stations = input.required<StationTelemetry[]>();

  protected readonly condition = computed<NetworkConditionView>(() => {
    const stations = this.stations();
    const status = stations.reduce<RiskStatus>(
      (worst, station) => worstStatus(worst, station.status),
      'NORMAL',
    );
    const affected = stations.filter((station) => station.status === status);

    const headline =
      status === 'NORMAL'
        ? `Rede em condição normal: ${stations.length} estações monitoradas`
        : affected.length === 1
          ? `${status} em ${affected[0]?.name}`
          : `${status} em ${affected.length} estações: ${listOf(affected.map(placeOf))}`;

    return {
      status,
      headline,
      guidance: GUIDANCE[status],
      counts: [...RISK_STATUS_ORDER]
        .reverse()
        .map((level) => ({
          status: level,
          count: stations.filter((station) => station.status === level).length,
        }))
        .filter((item) => item.count > 0),
    };
  });
}

function placeOf(station: StationTelemetry): string {
  return station.city.split(',')[0]?.trim() ?? station.city;
}

/** Junta nomes em português: "A, B e C". */
function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}
