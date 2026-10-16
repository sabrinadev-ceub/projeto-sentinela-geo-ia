import {
  DestroyRef,
  Injectable,
  Signal,
  computed,
  inject,
  linkedSignal,
  signal,
} from '@angular/core';
import { ALERT_CHANNEL_META } from '../../core/constants/emergency-channels';
import { EVACUATION_ROUTES } from '../../core/constants/evacuation-routes';
import { PN_PDC_GOAL, SENSOR_NETWORK } from '../../core/constants/pn-pdc-goals';
import { TELEMETRY_VARIABLES } from '../../core/constants/risk-thresholds';
import {
  AlertDispatch,
  ChannelDispatchStatus,
} from '../../core/domain/models/alert-dispatch.model';
import { RiskAssessment } from '../../core/domain/models/risk-assessment.model';
import {
  RISK_STATUS_ORDER,
  RiskStatus,
  StationTelemetry,
} from '../../core/domain/models/station-telemetry.model';
import { TelemetryRepository } from '../../core/domain/repositories/telemetry.repository';
import { CalculateRiskXaiUseCase } from '../../core/domain/use-cases/calculate-risk-xai.use-case';
import {
  TriggerEmergencyInput,
  TriggerEmergencyUseCase,
  buildMessage,
} from '../../core/domain/use-cases/trigger-emergency.use-case';
import { ModalDetail, ModalSeverity } from '../../shared/ui/modal/modal.model';
import { ModalService } from '../../shared/ui/modal/modal.service';
import {
  CommandCenterKpis,
  EmergencyBriefingData,
  HISTORY_SIZE,
  SyncStatus,
  TelemetrySample,
  WatchEvent,
} from '../models/command-center.models';
import { EmergencyBriefingComponent } from '../views/components/emergency-briefing/emergency-briefing.component';
import { formatInteger, formatReading } from '../views/formatters';

/** Responsável registrado na auditoria quando o disparo nasce da predição. */
export const AUTOMATIC_OPERATOR = 'Motor Sentinela GeoIA';

/** Responsável registrado na auditoria quando o operador de plantão aciona. */
export const MANUAL_OPERATOR = 'Operador de plantão da Sala de Situação';

/** Canais com resposta final: entram no denominador da taxa de entrega. */
const SETTLED_CHANNEL_STATUSES: ReadonlySet<ChannelDispatchStatus> = new Set([
  'SENT',
  'DELIVERED',
  'FAILED',
]);

/** Entradas exibidas no diário de vigilância, das mais recentes para as mais antigas. */
export const WATCH_LOG_SIZE = 6;

/**
 * Leituras seguidas no mesmo nível para o diário aceitar a mudança. Perto de
 * um limiar, o risco oscila e o status iria e voltaria a cada ciclo; exigir
 * que o novo nível se mantenha é a histerese que separa mudança de ruído.
 */
export const STATUS_CONFIRMATION_SAMPLES = 3;

/** Mudanças de nível guardadas, acima do que o diário exibe para não perder as recentes. */
const TRANSITION_BUFFER_SIZE = 40;

/** Histórico acumulado do streaming. */
interface WatchLedger {
  samples: Readonly<Record<string, TelemetrySample[]>>;
  /** Último nível aceito pelo diário em cada estação, já filtrado pela histerese. */
  confirmed: Readonly<Record<string, RiskStatus>>;
  transitions: WatchEvent[];
}

const EMPTY_LEDGER: WatchLedger = { samples: {}, confirmed: {}, transitions: [] };

const STATUS_SEVERITY: Record<RiskStatus, ModalSeverity> = {
  NORMAL: 'info',
  ATENÇÃO: 'warning',
  ALERTA: 'danger',
  'ALERTA MÁXIMO': 'critical',
};

/**
 * Controller da Central de Comando (MVC) e fachada sobre o domínio.
 *
 * A View só conhece esta classe: não injeta repositório, use case nem
 * `ModalService`. Todo estado sai daqui como `Signal` somente leitura, e toda
 * intenção do operador entra por um método de ação. Assim os componentes de
 * tela continuam puros, e trocar o mock por um backend real não toca em
 * template algum.
 */
@Injectable({ providedIn: 'root' })
export class CommandCenterFacade {
  private readonly repository = inject(TelemetryRepository);
  private readonly calculateRisk = inject(CalculateRiskXaiUseCase);
  private readonly triggerEmergency = inject(TriggerEmergencyUseCase);
  private readonly modal = inject(ModalService);

  private readonly selectedStationId = signal<string | null>(null);
  private readonly isOnline = signal(readNavigatorOnline());

  /** Contador e não booleano: dois disparos simultâneos não liberam a UI no primeiro que termina. */
  private readonly inFlightDispatches = signal(0);

  /** Avança a cada reinício da simulação, descartando o histórico acumulado. */
  private readonly ledgerEpoch = signal(0);

  /**
   * Histórico do streaming, acumulado a partir do valor anterior a cada nova
   * leitura. O repositório só guarda o estado atual; a evolução que os
   * gráficos e o diário mostram existe apenas aqui, na camada de apresentação.
   */
  private readonly ledger = linkedSignal<
    { stations: StationTelemetry[]; epoch: number },
    WatchLedger
  >({
    source: () => ({ stations: this.repository.stations(), epoch: this.ledgerEpoch() }),
    computation: ({ stations, epoch }, previous) =>
      appendToLedger(
        previous && previous.source.epoch === epoch ? previous.value : EMPTY_LEDGER,
        stations,
      ),
  });

  readonly stations: Signal<StationTelemetry[]> = this.repository.stations;

  /** Cai na primeira estação enquanto o operador não escolhe nenhuma. */
  readonly selectedStation: Signal<StationTelemetry | null> = computed(() => {
    const stations = this.stations();
    const id = this.selectedStationId();
    return stations.find((station) => station.id === id) ?? stations[0] ?? null;
  });

  /**
   * Predição completa da estação ativa. A entidade já traz `riskScore` e
   * `shapValues`, mas os drivers ordenados e a justificativa de escalada só
   * existem no `RiskAssessment`, e são eles que o painel de XAI explica.
   */
  readonly selectedAssessment: Signal<RiskAssessment | null> = computed(() => {
    const station = this.selectedStation();
    return station ? this.calculateRisk.execute(station) : null;
  });

  readonly alertHistory: Signal<AlertDispatch[]> = this.repository.dispatches;

  /** Leituras recentes da estação em foco, da mais antiga para a mais nova. */
  readonly selectedHistory: Signal<TelemetrySample[]> = computed(() => {
    const station = this.selectedStation();
    return station ? (this.ledger().samples[station.id] ?? []) : [];
  });

  /** Diário de vigilância: mudanças de nível e disparos, do mais recente para o mais antigo. */
  readonly watchLog: Signal<WatchEvent[]> = computed(() => {
    const dispatches = this.alertHistory().map<WatchEvent>((dispatch) => ({
      id: dispatch.id,
      kind: 'DISPATCH',
      at: dispatch.createdAt,
      stationName: dispatch.stationName,
      status: dispatch.status,
      description:
        `Disparo ${dispatch.triggeredBy === 'MANUAL' ? 'manual' : 'automático'} ` +
        `${dispatch.protocol} por ${dispatch.channels.length} ` +
        `${dispatch.channels.length === 1 ? 'canal' : 'canais'}`,
    }));

    return [...this.ledger().transitions, ...dispatches]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, WATCH_LOG_SIZE);
  });

  readonly isDispatching: Signal<boolean> = computed(() => this.inFlightDispatches() > 0);

  readonly canTriggerManualAlert: Signal<boolean> = computed(() => {
    const assessment = this.selectedAssessment();
    return (
      assessment !== null &&
      this.triggerEmergency.canTrigger(assessment.status) &&
      !this.isDispatching()
    );
  });

  readonly syncStatus: Signal<SyncStatus> = computed(() => ({
    isOnline: this.isOnline(),
    isStreaming: this.repository.isStreaming(),
    lastSyncAt: this.repository.lastSyncAt(),
    pendingDispatches: this.alertHistory().filter(
      (dispatch) => dispatch.syncState === 'PENDING_SYNC',
    ).length,
  }));

  readonly kpis: Signal<CommandCenterKpis> = computed(() => {
    const stations = this.stations();
    const dispatches = this.alertHistory();

    const sensorsPerStation = TELEMETRY_VARIABLES.length;
    const stationsOnline = stations.filter((station) => station.isOnline).length;

    const settled = dispatches
      .flatMap((dispatch) => dispatch.channels)
      .filter((channel) => SETTLED_CHANNEL_STATUSES.has(channel.status));
    const delivered = settled.filter((channel) => channel.status !== 'FAILED');

    const lastCompleted = dispatches.find((dispatch) => dispatch.responseTimeMs !== null);

    return {
      municipalities: {
        monitored: PN_PDC_GOAL.monitoredMunicipalities,
        target: PN_PDC_GOAL.targetMunicipalities,
        goalCode: PN_PDC_GOAL.code,
        horizon: PN_PDC_GOAL.horizon,
      },
      sensors: {
        online: stationsOnline * sensorsPerStation,
        total: stations.length * sensorsPerStation,
        stationsOnline,
        stationsTotal: stations.length,
        network: SENSOR_NETWORK,
      },
      alertLeadTime: {
        averageMs: PN_PDC_GOAL.averageAlertLeadTimeMs,
        targetMs: PN_PDC_GOAL.targetAlertLeadTimeMs,
        lastDispatchMs: lastCompleted?.responseTimeMs ?? null,
      },
      delivery: {
        rate: settled.length > 0 ? delivered.length / settled.length : null,
        delivered: delivered.length,
        attempted: settled.length,
        acknowledged: delivered.reduce((acc, channel) => acc + channel.acknowledged, 0),
        recipients: delivered.reduce((acc, channel) => acc + channel.recipients, 0),
      },
    };
  });

  constructor() {
    if (typeof window === 'undefined') return;

    const syncConnectivity = (): void => this.isOnline.set(readNavigatorOnline());
    window.addEventListener('online', syncConnectivity);
    window.addEventListener('offline', syncConnectivity);

    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('online', syncConnectivity);
      window.removeEventListener('offline', syncConnectivity);
    });
  }

  startMonitoring(): void {
    this.repository.startStream();
  }

  stopMonitoring(): void {
    this.repository.stopStream();
  }

  selectStation(stationId: string): void {
    if (this.repository.findStation(stationId)) this.selectedStationId.set(stationId);
  }

  /**
   * Leva a estação ativa a tempestade extrema e reage como a central reagiria
   * em operação: recalcula risco e SHAP, registra o disparo multicanal e abre
   * a modal de emergência com a ficha técnica e a rota de evacuação.
   *
   * A modal abre logo após o registro, sem esperar os canais: a sirene
   * responde em centenas de ms, mas o SMS leva segundos, e o operador não pode
   * ficar olhando para uma tela parada durante uma evacuação.
   */
  async simulateExtremeStorm(): Promise<void> {
    const target = this.selectedStation();
    if (!target) return;

    this.repository.simulateExtremeStorm(target.id);

    const station = this.repository.findStation(target.id);
    if (!station) return;

    const assessment = this.calculateRisk.execute(station);
    if (!this.triggerEmergency.canTrigger(assessment.status)) return;

    const startedAt = new Date().toISOString();
    const broadcast = this.dispatch({
      station,
      assessment,
      operator: AUTOMATIC_OPERATOR,
      triggeredBy: 'AUTOMATIC',
    });

    const briefing: EmergencyBriefingData = {
      station,
      route: EVACUATION_ROUTES[station.id] ?? null,
      dispatch: this.liveDispatch(station.id, startedAt),
    };

    this.modal.open<EmergencyBriefingData>({
      title: `${assessment.status}: ${station.name}`,
      overline: `Disparo automático · Bacia ${station.basin.code} ${station.basin.name}/${station.basin.state}`,
      message:
        `Tempestade extrema detectada em ${station.city}. O motor de IA classificou o risco em ` +
        `${assessment.riskScore}% e acionou a difusão multicanal e a rota de evacuação sem ` +
        `aguardar intervenção humana.`,
      severity: STATUS_SEVERITY[assessment.status],
      size: 'lg',
      dismissible: false,
      details: this.technicalDetails(station, assessment),
      content: EmergencyBriefingComponent,
      data: briefing,
      actions: [
        {
          id: 'acknowledge',
          label: 'Ciente, acompanhar evacuação',
          variant: 'danger',
          icon: 'directions_run',
          autoFocus: true,
        },
      ],
    });

    await broadcast;
  }

  /**
   * Alerta preventivo do operador. Abre a modal em modo de confirmação com a
   * mensagem exata que a população vai receber, e é essa mesma mensagem, não
   * uma regenerada depois, que segue para o disparo e para a auditoria.
   */
  async triggerManualAlert(): Promise<void> {
    const station = this.selectedStation();
    const assessment = this.selectedAssessment();
    if (!station || !assessment) return;

    if (!this.triggerEmergency.canTrigger(assessment.status)) {
      await this.modal.alert({
        title: 'Disparo preventivo indisponível',
        message:
          `${station.name} está em ${assessment.status}. O disparo à população só é ` +
          `autorizado a partir do nível ATENÇÃO, para não banalizar o alerta.`,
        severity: 'info',
      });
      return;
    }

    const message = buildMessage(station, assessment);

    const confirmed = await this.modal.confirm({
      title: 'Disparar alerta preventivo?',
      overline: `${station.name} · Bacia ${station.basin.code}`,
      message: `Mensagem à população: “${message}”`,
      severity: STATUS_SEVERITY[assessment.status],
      size: 'md',
      details: this.technicalDetails(station, assessment),
      confirmLabel: 'Disparar alerta',
      confirmIcon: 'campaign',
      cancelLabel: 'Cancelar',
    });

    if (!confirmed) return;

    await this.dispatch({
      station,
      assessment,
      operator: MANUAL_OPERATOR,
      triggeredBy: 'MANUAL',
      message,
    });
  }

  /** Devolve todas as estações às leituras de referência e limpa o log da simulação. */
  resetSimulation(): void {
    for (const station of this.repository.stations()) {
      this.repository.resetStation(station.id);
    }
    this.repository.clearAuditLog();
    this.selectedStationId.set(null);
    this.ledgerEpoch.update((epoch) => epoch + 1);
  }

  private async dispatch(input: TriggerEmergencyInput): Promise<AlertDispatch | null> {
    this.inFlightDispatches.update((count) => count + 1);

    try {
      return await this.triggerEmergency.execute(input);
    } catch (error) {
      void this.modal.alert({
        title: 'Falha no disparo do alerta',
        message: error instanceof Error ? error.message : String(error),
        severity: 'danger',
      });
      return null;
    } finally {
      this.inFlightDispatches.update((count) => count - 1);
    }
  }

  /**
   * Acompanha o disparo pelo histórico do repositório. É o mais antigo da
   * estação desde `since`: um disparo posterior da mesma estação é sempre mais
   * novo, então a modal nunca troca de protocolo no meio da difusão.
   */
  private liveDispatch(stationId: string, since: string): Signal<AlertDispatch | null> {
    return computed(() => {
      const matches = this.repository
        .dispatches()
        .filter((dispatch) => dispatch.stationId === stationId && dispatch.createdAt >= since);
      return matches[matches.length - 1] ?? null;
    });
  }

  /** Ficha técnica comum às modais de disparo automático e manual. */
  private technicalDetails(station: StationTelemetry, assessment: RiskAssessment): ModalDetail[] {
    const [first, second] = assessment.drivers;
    const channels = this.triggerEmergency
      .channelsFor(assessment.status)
      .map((channel) => ALERT_CHANNEL_META[channel].label)
      .join(', ');

    const details: ModalDetail[] = [
      { label: 'Probabilidade de risco', value: `${assessment.riskScore}%`, emphasis: true },
      { label: 'Nível operacional', value: assessment.status },
    ];

    if (first) {
      details.push({
        label: 'Fator dominante (SHAP)',
        value: `${first.shortLabel} · ${first.weight}% · ${formatReading(first.value, 2)} ${first.unit}`,
      });
    }
    if (second) {
      details.push({
        label: 'Segundo fator (SHAP)',
        value: `${second.shortLabel} · ${second.weight}% · ${formatReading(second.value, 2)} ${second.unit}`,
      });
    }
    if (assessment.escalationReason) {
      details.push({ label: 'Escalada de protocolo', value: assessment.escalationReason });
    }

    details.push(
      { label: 'População exposta', value: `${formatInteger(station.exposedPopulation)} pessoas` },
      { label: 'Canais acionados', value: channels || 'Nenhum' },
    );

    return details;
  }
}

/**
 * Acrescenta a leitura atual de cada estação ao histórico, ignorando a que já
 * foi registrada, e anota a mudança de nível no diário.
 *
 * A mudança só entra quando o novo nível se mantém por
 * `STATUS_CONFIRMATION_SAMPLES` leituras. A exceção é a escalada para ALERTA
 * ou acima, que entra na hora: esperar três ciclos para registrar o início de
 * uma emergência seria esconder justamente o evento que mais importa.
 */
function appendToLedger(ledger: WatchLedger, stations: readonly StationTelemetry[]): WatchLedger {
  const samples: Record<string, TelemetrySample[]> = { ...ledger.samples };
  const confirmed: Record<string, RiskStatus> = { ...ledger.confirmed };
  const transitions: WatchEvent[] = [];

  for (const station of stations) {
    const history = samples[station.id] ?? [];
    if (history[history.length - 1]?.at === station.measuredAt) continue;

    const next = [
      ...history,
      {
        at: station.measuredAt,
        riskScore: station.riskScore,
        status: station.status,
        readings: { ...station.readings },
      },
    ].slice(-HISTORY_SIZE);
    samples[station.id] = next;

    const previous = confirmed[station.id];
    if (previous === undefined) {
      confirmed[station.id] = station.status;
      continue;
    }
    if (previous === station.status) continue;

    const recent = next.slice(-STATUS_CONFIRMATION_SAMPLES);
    const held =
      recent.length === STATUS_CONFIRMATION_SAMPLES &&
      recent.every((sample) => sample.status === station.status);
    const urgent =
      rankOf(station.status) > rankOf(previous) && rankOf(station.status) >= rankOf('ALERTA');

    if (!held && !urgent) continue;

    confirmed[station.id] = station.status;
    transitions.push({
      id: `${station.id}:${station.measuredAt}`,
      kind: 'STATUS_CHANGE',
      at: station.measuredAt,
      stationName: station.name,
      status: station.status,
      description: `Nível passou de ${previous} para ${station.status}`,
    });
  }

  return {
    samples,
    confirmed,
    transitions:
      transitions.length > 0
        ? [...ledger.transitions, ...transitions].slice(-TRANSITION_BUFFER_SIZE)
        : ledger.transitions,
  };
}

function rankOf(status: RiskStatus): number {
  return RISK_STATUS_ORDER.indexOf(status);
}

function readNavigatorOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}
