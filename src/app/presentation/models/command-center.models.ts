import { Signal } from '@angular/core';
import { AlertDispatch } from '../../core/domain/models/alert-dispatch.model';
import { EvacuationRoute } from '../../core/domain/models/evacuation-route.model';
import {
  RiskStatus,
  SensorReading,
  StationTelemetry,
} from '../../core/domain/models/station-telemetry.model';

/** Leituras guardadas por estação: 45 ciclos de 4 s cobrem 3 minutos de evolução. */
export const HISTORY_SIZE = 45;

/** Uma leitura do streaming, guardada para os gráficos de evolução. */
export interface TelemetrySample {
  /** ISO-8601 da leitura. */
  at: string;
  riskScore: number;
  status: RiskStatus;
  readings: SensorReading;
}

export type WatchEventKind = 'STATUS_CHANGE' | 'DISPATCH';

/** Entrada do diário de vigilância: mudança de nível ou disparo à população. */
export interface WatchEvent {
  id: string;
  kind: WatchEventKind;
  /** ISO-8601 do evento. */
  at: string;
  stationName: string;
  /** Nível depois do evento: o novo nível na mudança, a severidade no disparo. */
  status: RiskStatus;
  description: string;
}

/** Estado de sincronização do PWA offline-first. */
export interface SyncStatus {
  /** Conectividade do navegador, acompanhada pelos eventos `online`/`offline`. */
  isOnline: boolean;
  isStreaming: boolean;
  /** ISO-8601 da última persistência local. */
  lastSyncAt: string | null;
  /** Disparos registrados sem rede, aguardando sincronização com a central. */
  pendingDispatches: number;
}

/**
 * KPIs globais da central. A View recebe números crus e decide a formatação:
 * o Facade não sabe se o valor vira card, gráfico ou linha de relatório.
 */
export interface CommandCenterKpis {
  municipalities: {
    monitored: number;
    target: number;
    goalCode: string;
    horizon: string;
  };
  sensors: {
    online: number;
    total: number;
    stationsOnline: number;
    stationsTotal: number;
    network: string;
  };
  alertLeadTime: {
    averageMs: number;
    targetMs: number;
    /** Tempo de resposta do disparo mais recente já concluído desta central. */
    lastDispatchMs: number | null;
  };
  delivery: {
    /** Fração de 0 a 1; `null` antes de qualquer canal concluir. */
    rate: number | null;
    delivered: number;
    attempted: number;
    acknowledged: number;
    recipients: number;
  };
}

/**
 * Carga da modal de emergência, entregue por `MODAL_DATA`.
 *
 * `dispatch` é um `Signal` e não um valor: a modal abre no instante do
 * registro, e cada canal responde depois. Com o signal, o operador vê a
 * difusão acontecer (de `PENDING` para `DELIVERED`, com a latência medida)
 * sem a modal precisar ser reaberta.
 */
export interface EmergencyBriefingData {
  station: StationTelemetry;
  route: EvacuationRoute | null;
  dispatch: Signal<AlertDispatch | null>;
}
