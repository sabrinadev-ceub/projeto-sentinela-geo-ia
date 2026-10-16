import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { PN_PDC_GOAL, SENSOR_NETWORK } from '../../../../core/constants/pn-pdc-goals';
import { CommandCenterFacade } from '../../../controllers/command-center.facade';
import { AlertAuditTableComponent } from '../../components/alert-audit-table/alert-audit-table.component';
import { KpiSummaryBarComponent } from '../../components/kpi-summary-bar/kpi-summary-bar.component';
import { NetworkStatusBarComponent } from '../../components/network-status-bar/network-status-bar.component';
import { StationMapComponent } from '../../components/station-map/station-map.component';
import { StationMonitorGridComponent } from '../../components/station-monitor-grid/station-monitor-grid.component';
import { StationSelectorComponent } from '../../components/station-selector/station-selector.component';
import { WatchLogComponent } from '../../components/watch-log/watch-log.component';
import { XaiShapPanelComponent } from '../../components/xai-shap-panel/xai-shap-panel.component';
import { formatTime } from '../../formatters';

const clockDate = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

/**
 * Página da Central de Comando e único componente smart da tela.
 *
 * A ordem dos blocos é a ordem de leitura do plantão: condição da rede, onde
 * está o risco (mapa, lista e diário), risco da estação em foco e o porquê,
 * leituras que o sustentam, o que já foi disparado e, por último, os
 * indicadores de longo prazo da meta.
 *
 * Injeta apenas o Facade, lê o estado dele e repassa por `input` aos
 * componentes puros; os `output` deles voltam como chamadas de ação. Nenhum
 * filho conhece o Facade, então qualquer um pode ser reaproveitado em outra
 * tela alimentado por outra fonte.
 */
@Component({
  selector: 'app-command-center-page',
  imports: [
    NetworkStatusBarComponent,
    StationMapComponent,
    StationSelectorComponent,
    WatchLogComponent,
    XaiShapPanelComponent,
    StationMonitorGridComponent,
    AlertAuditTableComponent,
    KpiSummaryBarComponent,
  ],
  templateUrl: './command-center.page.html',
  styleUrl: './command-center.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommandCenterPage {
  protected readonly facade = inject(CommandCenterFacade);

  protected readonly goal = PN_PDC_GOAL;
  protected readonly sensorNetwork = SENSOR_NETWORK;

  private readonly now = signal(new Date());

  /** Enlace ativo e nada na fila: o ponto pulsa. Qualquer pendência o apaga. */
  protected readonly telemetryLive = computed(() => {
    const { isOnline, pendingDispatches } = this.facade.syncStatus();
    return isOnline && pendingDispatches === 0;
  });

  protected readonly telemetryLabel = computed(() =>
    this.telemetryLive()
      ? `Telemetria ${SENSOR_NETWORK} ativa e PWA sincronizado`
      : `Telemetria ${SENSOR_NETWORK} com sincronização pendente`,
  );

  /**
   * A estação em foco já está em ALERTA MÁXIMO: o botão de tempestade passa
   * do âmbar ao vermelho para lembrar que a simulação está em curso.
   */
  protected readonly stormActive = computed(
    () => this.facade.selectedStation()?.status === 'ALERTA MÁXIMO',
  );

  /** Relógio operacional: registros de plantão são lidos e anotados pela hora. */
  protected readonly clock = computed(() => {
    const now = this.now();
    return { time: formatTime(now.toISOString()), date: clockDate.format(now) };
  });

  /**
   * Só fala quando algo foge do normal. Online e sincronizado é o estado
   * esperado e não merece espaço na tela; sem rede ou com disparo na fila, o
   * operador precisa saber que o alerta ainda não chegou à população.
   */
  protected readonly syncWarning = computed<string | null>(() => {
    const { isOnline, lastSyncAt, pendingDispatches } = this.facade.syncStatus();
    const queue =
      pendingDispatches === 1
        ? '1 disparo na fila offline'
        : `${pendingDispatches} disparos na fila offline`;

    if (!isOnline) {
      const since = `Sem conexão desde ${formatTime(lastSyncAt)}`;
      return pendingDispatches > 0 ? `${since} · ${queue}` : since;
    }
    return pendingDispatches > 0 ? `${queue}, aguardando sincronização` : null;
  });

  constructor() {
    this.facade.startMonitoring();

    const ticker = setInterval(() => this.now.set(new Date()), 1000);

    inject(DestroyRef).onDestroy(() => {
      clearInterval(ticker);
      this.facade.stopMonitoring();
    });
  }

  protected onStationSelected(stationId: string): void {
    this.facade.selectStation(stationId);
  }

  protected onManualAlertRequested(): void {
    void this.facade.triggerManualAlert();
  }

  protected simulateStorm(): void {
    void this.facade.simulateExtremeStorm();
  }

  protected resetSimulation(): void {
    this.facade.resetSimulation();
  }
}
