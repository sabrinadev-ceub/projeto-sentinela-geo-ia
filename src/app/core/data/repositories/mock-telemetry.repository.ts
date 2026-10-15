import { Injectable, OnDestroy, Signal, computed, effect, inject, signal } from '@angular/core';
import { STORAGE_KEYS } from '../../constants/storage-keys';
import { buildStationThresholds } from '../../constants/risk-thresholds';
import { AlertDispatch } from '../../domain/models/alert-dispatch.model';
import {
  GeoPosition,
  HydroBasin,
  RiskTrend,
  SensorReading,
  StationTelemetry,
  StationThresholds,
} from '../../domain/models/station-telemetry.model';
import { TelemetryRepository } from '../../domain/repositories/telemetry.repository';
import { CalculateRiskXaiUseCase } from '../../domain/use-cases/calculate-risk-xai.use-case';
import { StorageService } from '../../services/storage.service';

/** Intervalo padrão do streaming, equilibrando leitura viva e carga de CPU. */
export const DEFAULT_STREAM_INTERVAL_MS = 4000;

/** Definição estática de uma estação, antes de a predição ser materializada. */
interface StationSeed {
  id: string;
  name: string;
  city: string;
  basin: HydroBasin;
  position: GeoPosition;
  exposedPopulation: number;
  thresholds: StationThresholds;
  readings: SensorReading;
}

/**
 * Estações iniciais, ancoradas em bacias da Divisão Hidrográfica Nacional
 * citadas no PN-PDC 2025-2035. A cota do rio é sobrescrita por estação porque
 * cada régua tem a sua própria cota de inundação.
 */
const STATION_SEEDS: readonly StationSeed[] = [
  {
    id: 'EST-RS-62-MUCUM',
    name: 'Estação Muçum — Rio Taquari',
    city: 'Muçum, RS',
    basin: {
      code: '62',
      name: 'Taquari-Antas',
      state: 'RS',
      region: 'Sul',
    },
    position: { latitude: -29.1667, longitude: -51.8711, altitude: 65 },
    exposedPopulation: 4766,
    thresholds: buildStationThresholds({
      riverLevel: { attention: 11, alert: 15, maximum: 19 },
    }),
    readings: {
      rainfall24h: 34,
      accumulatedRainfall5d: 96,
      riverLevel: 8.2,
      soilSaturation: 71,
      slopeDisplacement: 0.9,
    },
  },
  {
    id: 'EST-RJ-38-PETROPOLIS',
    name: 'Estação Morro da Oficina — Petrópolis',
    city: 'Petrópolis, RJ',
    basin: {
      code: '38',
      name: 'Litorânea do Rio de Janeiro',
      state: 'RJ',
      region: 'Sudeste',
    },
    position: { latitude: -22.5052, longitude: -43.1784, altitude: 845 },
    exposedPopulation: 12480,
    thresholds: buildStationThresholds({
      riverLevel: { attention: 1.6, alert: 2.3, maximum: 3.1 },
      slopeDisplacement: { attention: 2, alert: 8, maximum: 24 },
    }),
    readings: {
      rainfall24h: 46,
      accumulatedRainfall5d: 128,
      riverLevel: 1.42,
      soilSaturation: 78,
      slopeDisplacement: 3.4,
    },
  },
  {
    id: 'EST-PE-33-JABOATAO',
    name: 'Estação Jardim Monte Verde — Jaboatão',
    city: 'Jaboatão dos Guararapes, PE',
    basin: {
      code: '33',
      name: 'Litorânea de Pernambuco',
      state: 'PE',
      region: 'Nordeste',
    },
    position: { latitude: -8.1128, longitude: -35.0147, altitude: 42 },
    exposedPopulation: 8930,
    thresholds: buildStationThresholds({
      riverLevel: { attention: 2.4, alert: 3.2, maximum: 4 },
    }),
    readings: {
      rainfall24h: 9,
      accumulatedRainfall5d: 41,
      riverLevel: 1.35,
      soilSaturation: 48,
      slopeDisplacement: 0.3,
    },
  },
];

/**
 * Implementação de `TelemetryRepository` em memória, com streaming simulado.
 *
 * A deriva das leituras é pseudoaleatória, mas **semeada pelo id da estação**:
 * duas execuções do app a partir do mesmo estado produzem a mesma sequência de
 * leituras, o que torna possível reproduzir um incidente em desenvolvimento.
 *
 * As leituras são persistidas em LocalStorage a cada ciclo, de modo que
 * recarregar a página continua de onde parou — é o mesmo contrato que um
 * service worker precisaria honrar em operação real.
 */
@Injectable({ providedIn: 'root' })
export class MockTelemetryRepository extends TelemetryRepository implements OnDestroy {
  private readonly storage = inject(StorageService);
  private readonly calculateRisk = inject(CalculateRiskXaiUseCase);

  private readonly _stations = signal<StationTelemetry[]>(this.hydrateStations());
  private readonly _dispatches = signal<AlertDispatch[]>(this.hydrateDispatches());
  private readonly _isStreaming = signal(false);
  private readonly _lastSyncAt = signal<string | null>(
    this.storage.get<string>(STORAGE_KEYS.LAST_SYNC),
  );

  override readonly stations: Signal<StationTelemetry[]> = this._stations.asReadonly();

  override readonly dispatches: Signal<AlertDispatch[]> = computed(() =>
    [...this._dispatches()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  );

  override readonly isStreaming: Signal<boolean> = this._isStreaming.asReadonly();
  override readonly lastSyncAt: Signal<string | null> = this._lastSyncAt.asReadonly();

  /** Geradores pseudoaleatórios por estação, semeados pelo id. */
  private readonly generators = new Map<string, () => number>();

  /** Intensidade de tempestade em curso por estação, de 0 a 1. Decai a cada ciclo. */
  private readonly stormIntensity = new Map<string, number>();

  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super();

    effect(() => {
      this.storage.set(STORAGE_KEYS.STATIONS, this._stations());
      const now = new Date().toISOString();
      this.storage.set(STORAGE_KEYS.LAST_SYNC, now);
      this._lastSyncAt.set(now);
    });

    effect(() => {
      this.storage.set(STORAGE_KEYS.DISPATCHES, this._dispatches());
    });
  }

  ngOnDestroy(): void {
    this.stopStream();
  }

  override findStation(id: string): StationTelemetry | undefined {
    return this._stations().find((station) => station.id === id);
  }

  override startStream(intervalMs: number = DEFAULT_STREAM_INTERVAL_MS): void {
    if (this.timer !== null) return;

    this.timer = setInterval(() => this.tick(), intervalMs);
    this._isStreaming.set(true);
  }

  override stopStream(): void {
    if (this.timer === null) return;

    clearInterval(this.timer);
    this.timer = null;
    this._isStreaming.set(false);
  }

  override pushReading(stationId: string, readings: Partial<SensorReading>): void {
    this.patchStation(stationId, (station) =>
      this.reassess(station, { ...station.readings, ...readings }),
    );
  }

  override simulateExtremeStorm(stationId: string): void {
    this.stormIntensity.set(stationId, 1);

    this.patchStation(stationId, (station) => {
      const t = station.thresholds;

      return this.reassess(station, {
        rainfall24h: round(t.rainfall24h.maximum * 1.4, 1),
        accumulatedRainfall5d: round(t.accumulatedRainfall5d.maximum * 1.65, 1),
        riverLevel: round(t.riverLevel.maximum * 1.08, 2),
        soilSaturation: Math.min(99, round(t.soilSaturation.maximum * 1.03, 1)),
        slopeDisplacement: round(t.slopeDisplacement.alert * 1.2, 2),
      });
    });
  }

  override resetStation(stationId: string): void {
    const seed = STATION_SEEDS.find((candidate) => candidate.id === stationId);
    if (!seed) return;

    this.stormIntensity.delete(stationId);
    this.generators.delete(stationId);

    this.patchStation(stationId, (station) => ({
      ...this.reassess(station, { ...seed.readings }),
      isOnline: true,
      trend: 'STABLE',
    }));
  }

  override setStationOnline(stationId: string, isOnline: boolean): void {
    this.patchStation(stationId, (station) => ({ ...station, isOnline }));
  }

  override saveDispatch(dispatch: AlertDispatch): void {
    this._dispatches.update((list) => [...list, dispatch]);
  }

  override updateDispatch(id: string, patch: Partial<AlertDispatch>): void {
    this._dispatches.update((list) =>
      list.map((dispatch) =>
        dispatch.id === id
          ? { ...dispatch, ...patch, id: dispatch.id, protocol: dispatch.protocol }
          : dispatch,
      ),
    );
  }

  override nextProtocolSequence(): number {
    const year = new Date().getFullYear();
    const prefix = `-${year}-`;
    const issued = this._dispatches().filter((dispatch) => dispatch.protocol.includes(prefix));
    return issued.length + 1;
  }

  override clearAuditLog(): void {
    this._dispatches.set([]);
  }

  /** Avança um ciclo do streaming em todas as estações com enlace ativo. */
  private tick(): void {
    this._stations.update((list) =>
      list.map((station) => {
        if (!station.isOnline) return station;

        const next = this.reassess(station, this.drift(station));
        this.decayStorm(station.id);
        return next;
      }),
    );
  }

  /**
   * Deriva a próxima leitura. Cada variável persegue um alvo por aproximação
   * exponencial, e o acoplamento entre elas respeita a cadeia física: a chuva
   * alimenta o acumulado, o acumulado satura o solo, o solo eleva o rio e
   * movimenta a encosta.
   */
  private drift(station: StationTelemetry): SensorReading {
    const random = this.randomFor(station.id);
    const storm = this.stormIntensity.get(station.id) ?? 0;
    const t = station.thresholds;
    const current = station.readings;

    const jitter = (): number => (random() - 0.5) * 2;

    const rainTarget =
      storm > 0 ? t.rainfall24h.maximum * 1.35 * storm : t.rainfall24h.attention * 0.35;
    const rainfall24h = clamp(
      current.rainfall24h +
        (rainTarget - current.rainfall24h) * (storm > 0 ? 0.24 : 0.06) +
        jitter() * 1.8,
      0,
      t.rainfall24h.maximum * 1.8,
    );

    const accumulatedRainfall5d = clamp(
      current.accumulatedRainfall5d * 0.985 + rainfall24h * 0.075 + jitter() * 0.6,
      0,
      t.accumulatedRainfall5d.maximum * 2,
    );

    const soilSaturation = clamp(
      current.soilSaturation + (rainfall24h / t.rainfall24h.maximum) * 2.2 - 0.55 + jitter() * 0.3,
      4,
      100,
    );

    const riverLevel = clamp(
      current.riverLevel +
        (accumulatedRainfall5d / t.accumulatedRainfall5d.maximum) * 0.085 +
        (rainfall24h / t.rainfall24h.maximum) * 0.06 -
        0.055 +
        jitter() * 0.02,
      0.15,
      t.riverLevel.maximum * 1.6,
    );

    const slopePressure = Math.max(
      0,
      (soilSaturation - t.soilSaturation.attention) / (100 - t.soilSaturation.attention),
    );
    const slopeDisplacement = clamp(
      current.slopeDisplacement + slopePressure * 1.5 - 0.35 + jitter() * 0.12,
      0,
      t.slopeDisplacement.maximum * 2.5,
    );

    return {
      rainfall24h: round(rainfall24h, 1),
      accumulatedRainfall5d: round(accumulatedRainfall5d, 1),
      riverLevel: round(riverLevel, 2),
      soilSaturation: round(soilSaturation, 1),
      slopeDisplacement: round(slopeDisplacement, 2),
    };
  }

  /** Recalcula a predição e deriva a tendência comparando com o ciclo anterior. */
  private reassess(station: StationTelemetry, readings: SensorReading): StationTelemetry {
    const assessment = this.calculateRisk.evaluate(readings, station.thresholds);

    return {
      ...station,
      readings,
      status: assessment.status,
      riskScore: assessment.riskScore,
      shapValues: assessment.shapValues,
      trend: trendOf(station.riskScore, assessment.riskScore),
      measuredAt: assessment.evaluatedAt,
    };
  }

  private patchStation(
    stationId: string,
    patch: (station: StationTelemetry) => StationTelemetry,
  ): void {
    this._stations.update((list) =>
      list.map((station) => (station.id === stationId ? patch(station) : station)),
    );
  }

  private decayStorm(stationId: string): void {
    const storm = this.stormIntensity.get(stationId);
    if (storm === undefined) return;

    const next = storm * 0.86;
    if (next < 0.02) this.stormIntensity.delete(stationId);
    else this.stormIntensity.set(stationId, next);
  }

  private randomFor(stationId: string): () => number {
    const existing = this.generators.get(stationId);
    if (existing) return existing;

    const generator = createRandom(seedOf(stationId));
    this.generators.set(stationId, generator);
    return generator;
  }

  /**
   * Restaura as leituras gravadas, mas sempre remateriza a predição: assim uma
   * mudança de limiar ou de peso do modelo vale também para o estado antigo.
   */
  private hydrateStations(): StationTelemetry[] {
    const stored = this.storage.get<StationTelemetry[]>(STORAGE_KEYS.STATIONS);

    return STATION_SEEDS.map((seed) => {
      const saved = stored?.find((station) => station.id === seed.id);
      const readings = saved?.readings ?? seed.readings;
      const assessment = this.calculateRisk.evaluate(readings, seed.thresholds);

      return {
        id: seed.id,
        name: seed.name,
        city: seed.city,
        basin: { ...seed.basin },
        position: { ...seed.position },
        exposedPopulation: seed.exposedPopulation,
        thresholds: seed.thresholds,
        readings,
        status: assessment.status,
        riskScore: assessment.riskScore,
        shapValues: assessment.shapValues,
        trend: saved?.trend ?? 'STABLE',
        measuredAt: assessment.evaluatedAt,
        isOnline: saved?.isOnline ?? true,
      };
    });
  }

  private hydrateDispatches(): AlertDispatch[] {
    return this.storage.get<AlertDispatch[]>(STORAGE_KEYS.DISPATCHES) ?? [];
  }
}

function trendOf(previous: number, next: number): RiskTrend {
  if (next - previous >= 2) return 'RISING';
  if (previous - next >= 2) return 'FALLING';
  return 'STABLE';
}

/** Congruência linear de 32 bits: barata, estável e suficiente para simulação. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function seedOf(value: string): number {
  let hash = 0x811c9dc5;

  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
