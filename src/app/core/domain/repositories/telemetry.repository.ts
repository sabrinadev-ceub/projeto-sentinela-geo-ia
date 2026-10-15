import { Signal } from '@angular/core';
import { AlertDispatch } from '../models/alert-dispatch.model';
import { SensorReading, StationTelemetry } from '../models/station-telemetry.model';

/**
 * Contrato de acesso à telemetria e ao histórico de alertas.
 *
 * É uma `abstract class` em vez de uma `interface` por dois motivos: serve
 * como token de injeção em runtime (`inject(TelemetryRepository)`) e permite
 * inverter a dependência (DIP) — os use cases e as features dependem desta
 * classe, nunca de `MockTelemetryRepository` ou de um futuro cliente HTTP.
 *
 * O estado é exposto como `Signal` para que a camada de apresentação derive
 * tudo com `computed()` sem assinar nem cancelar inscrições.
 */
export abstract class TelemetryRepository {
  /** Estações monitoradas, já com a predição materializada. */
  abstract readonly stations: Signal<StationTelemetry[]>;

  /** Histórico auditável de disparos, do mais recente para o mais antigo. */
  abstract readonly dispatches: Signal<AlertDispatch[]>;

  /** `true` enquanto o streaming de sensores estiver ativo. */
  abstract readonly isStreaming: Signal<boolean>;

  /** ISO-8601 da última persistência local; `null` antes do primeiro ciclo. */
  abstract readonly lastSyncAt: Signal<string | null>;

  abstract findStation(id: string): StationTelemetry | undefined;

  /** Inicia o streaming contínuo. Chamar duas vezes não duplica o ciclo. */
  abstract startStream(intervalMs?: number): void;

  abstract stopStream(): void;

  /** Aplica uma leitura externa e recalcula a predição da estação. */
  abstract pushReading(stationId: string, readings: Partial<SensorReading>): void;

  /** Leva a estação a condição de tempestade extrema (ALERTA MÁXIMO). */
  abstract simulateExtremeStorm(stationId: string): void;

  /** Devolve a estação às condições de referência. */
  abstract resetStation(stationId: string): void;

  /** Derruba ou restabelece o enlace do sensor. */
  abstract setStationOnline(stationId: string, isOnline: boolean): void;

  abstract saveDispatch(dispatch: AlertDispatch): void;

  /** Atualiza um disparo já registrado, preservando o protocolo. */
  abstract updateDispatch(id: string, patch: Partial<AlertDispatch>): void;

  /** Próximo número sequencial de protocolo do ano corrente. */
  abstract nextProtocolSequence(): number;

  abstract clearAuditLog(): void;
}
