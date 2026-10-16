import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import {
  RiskStatus,
  RiskTrend,
  StationTelemetry,
} from '../../../../core/domain/models/station-telemetry.model';

export interface StationOptionView {
  id: string;
  name: string;
  location: string;
  status: RiskStatus;
  riskScore: number;
  trendSymbol: string;
  trendLabel: string;
  isOnline: boolean;
  selected: boolean;
}

const TREND_META: Record<RiskTrend, { symbol: string; label: string }> = {
  RISING: { symbol: '↑', label: 'Risco em alta' },
  STABLE: { symbol: '→', label: 'Risco estável' },
  FALLING: { symbol: '↓', label: 'Risco em queda' },
};

/**
 * Lista das estações da rede, ao lado do mapa, e seletor da estação em foco.
 * O mapa mostra onde está o risco; a lista dá o nome, o código e a
 * tendência de cada estação para o operador escolher qual examinar.
 */
@Component({
  selector: 'app-station-selector',
  templateUrl: './station-selector.component.html',
  styleUrl: './station-selector.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StationSelectorComponent {
  readonly stations = input.required<StationTelemetry[]>();
  readonly selectedStationId = input.required<string | null>();

  readonly stationSelected = output<string>();

  protected readonly options = computed<StationOptionView[]>(() => {
    const selectedId = this.selectedStationId();

    return this.stations().map((station) => ({
      id: station.id,
      name: station.name,
      location: station.city,
      status: station.status,
      riskScore: station.riskScore,
      trendSymbol: TREND_META[station.trend].symbol,
      trendLabel: TREND_META[station.trend].label,
      isOnline: station.isOnline,
      selected: station.id === selectedId,
    }));
  });

  protected select(stationId: string): void {
    this.stationSelected.emit(stationId);
  }
}
