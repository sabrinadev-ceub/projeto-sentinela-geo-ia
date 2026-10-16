import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import {
  RISK_STATUS_ORDER,
  RiskStatus,
  StationTelemetry,
} from '../../../../core/domain/models/station-telemetry.model';
import { BRAZIL_BOUNDS, BRAZIL_OUTLINE_PATH } from './brazil-outline';

export interface MapMarkerView {
  id: string;
  /** Longitude, que é o `x` do mapa. */
  x: number;
  /** Latitude negada, que é o `y` do mapa. */
  y: number;
  place: string;
  riskScore: number;
  status: RiskStatus;
  isOnline: boolean;
  selected: boolean;
  /** Pulso de chamada de atenção, reservado ao nível que exige evacuação. */
  pulses: boolean;
  /** Mira da estação em foco: quatro traços ao redor do ponto, sem cruzá-lo. */
  crosshair: string;
  /** Lado do rótulo, escolhido para não sobrepor o rótulo de outra estação. */
  labelSide: LabelSide;
  /** Âncora do rótulo, já deslocada para a posição escolhida. */
  labelX: number;
  labelY: number;
  /**
   * Rótulo sem espaço livre no mapa. Fica oculto até o foco ou o mouse chegar
   * ao ponto; a lista ao lado continua nomeando a estação.
   */
  labelHidden: boolean;
  ariaLabel: string;
}

export type LabelSide = 'left' | 'right';

interface LabelPlacement {
  side: LabelSide;
  /** Deslocamento vertical do rótulo em relação ao ponto, em graus. */
  dy: number;
  hidden: boolean;
}

export interface GraticuleLine {
  value: number;
  label: string;
}

/** Margem em graus ao redor do contorno, para os rótulos não encostarem na borda. */
const MAP_MARGIN = 2.5;

/**
 * Métrica aproximada do rótulo em graus, coerente com os tamanhos de fonte do
 * SCSS. Não precisa ser exata: serve só para decidir de que lado do ponto o
 * rótulo cabe sem cobrir o de outra estação.
 */
const LABEL = { gap: 3.4, charWidth: 0.8, above: 1.8, below: 2.4 } as const;

/** Posições tentadas em ordem: ao lado do ponto, depois um pouco acima e abaixo. */
const LABEL_CANDIDATES: readonly { side: LabelSide; dy: number }[] = [
  { side: 'left', dy: 0 },
  { side: 'right', dy: 0 },
  { side: 'left', dy: -2.6 },
  { side: 'right', dy: -2.6 },
  { side: 'left', dy: 2.6 },
  { side: 'right', dy: 2.6 },
];

/** Nomes longos ficam só com a primeira palavra para não cobrir o mapa. */
const MAX_PLACE_LENGTH = 16;

const VIEW = {
  x: BRAZIL_BOUNDS.minLon - MAP_MARGIN,
  y: -BRAZIL_BOUNDS.maxLat - MAP_MARGIN,
  width: BRAZIL_BOUNDS.maxLon - BRAZIL_BOUNDS.minLon + MAP_MARGIN * 2,
  height: BRAZIL_BOUNDS.maxLat - BRAZIL_BOUNDS.minLat + MAP_MARGIN * 2,
} as const;

const LATITUDES: GraticuleLine[] = [0, -10, -20, -30].map((lat) => ({
  value: -lat,
  label: lat === 0 ? '0°' : `${Math.abs(lat)}°S`,
}));

const LONGITUDES: GraticuleLine[] = [-70, -60, -50, -40].map((lon) => ({
  value: lon,
  label: `${Math.abs(lon)}°O`,
}));

/**
 * Mapa esquemático da rede de monitoramento. Coloca cada estação na sua
 * coordenada real sobre o contorno do país: o operador vê de relance onde
 * está o risco, não só qual estação está em risco.
 *
 * Componente puro: a seleção sobe por `stationSelected`.
 */
@Component({
  selector: 'app-station-map',
  templateUrl: './station-map.component.html',
  styleUrl: './station-map.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StationMapComponent {
  readonly stations = input.required<StationTelemetry[]>();
  readonly selectedStationId = input.required<string | null>();

  readonly stationSelected = output<string>();

  protected readonly outline = BRAZIL_OUTLINE_PATH;
  protected readonly viewBox = `${VIEW.x} ${VIEW.y} ${VIEW.width} ${VIEW.height}`;
  protected readonly view = VIEW;
  protected readonly latitudes = LATITUDES;
  protected readonly longitudes = LONGITUDES;

  protected readonly markers = computed<MapMarkerView[]>(() => {
    const selectedId = this.selectedStationId();
    const stations = this.stations();
    const placements = placeLabels(stations, selectedId);

    return stations.map((station) => {
      const place = placeOf(station);
      const label = placements.get(station.id) ?? { side: 'left', dy: 0, hidden: false };
      const x = station.position.longitude;

      return {
        id: station.id,
        x: station.position.longitude,
        y: -station.position.latitude,
        place,
        riskScore: station.riskScore,
        status: station.status,
        isOnline: station.isOnline,
        selected: station.id === selectedId,
        pulses: station.status === 'ALERTA MÁXIMO',
        crosshair: crosshairPath(station.position.longitude, -station.position.latitude),
        labelSide: label.side,
        labelX: label.side === 'left' ? x - LABEL.gap : x + LABEL.gap,
        labelY: -station.position.latitude + label.dy,
        labelHidden: label.hidden,
        ariaLabel: `${station.name}: ${station.status}, risco de ${station.riskScore}%`,
      };
    });
  });

  protected select(stationId: string): void {
    this.stationSelected.emit(stationId);
  }
}

/** Traços da mira, em graus: começam a `gap` do centro e medem `length`. */
function crosshairPath(x: number, y: number, gap = 1.4, length = 1.4): string {
  const reach = gap + length;
  return (
    `M${x - reach} ${y}h${length}` +
    `M${x + gap} ${y}h${length}` +
    `M${x} ${y - reach}v${length}` +
    `M${x} ${y + gap}v${length}`
  );
}

function placeOf(station: StationTelemetry): string {
  const city = station.city.split(',')[0]?.trim() ?? station.city;
  return city.length > MAX_PLACE_LENGTH ? (city.split(' ')[0] ?? city) : city;
}

interface Box {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

/**
 * Posiciona os rótulos de forma gulosa: a estação em foco e as mais graves
 * escolhem primeiro, e cada rótulo fica na primeira posição candidata que cai
 * dentro do mapa sem cobrir rótulo nem ponto já posicionado.
 *
 * Quando nenhuma posição está livre, a estação em foco e as que estão em
 * ALERTA ou acima ficam com a de menor sobreposição, porque o nome delas não
 * pode sumir; as demais ficam com o rótulo oculto.
 */
function placeLabels(
  stations: readonly StationTelemetry[],
  selectedId: string | null,
): Map<string, LabelPlacement> {
  const rank = (station: StationTelemetry): number =>
    (station.id === selectedId ? 100 : 0) + RISK_STATUS_ORDER.indexOf(station.status);
  const mustShow = (station: StationTelemetry): boolean =>
    station.id === selectedId ||
    RISK_STATUS_ORDER.indexOf(station.status) >= RISK_STATUS_ORDER.indexOf('ALERTA');

  const dots: Box[] = stations.map((station) => {
    const x = station.position.longitude;
    const y = -station.position.latitude;
    return { x1: x - 1, x2: x + 1, y1: y - 1, y2: y + 1 };
  });

  const placed: Box[] = [];
  const placements = new Map<string, LabelPlacement>();

  for (const station of [...stations].sort((a, b) => rank(b) - rank(a))) {
    const x = station.position.longitude;
    const y = -station.position.latitude;
    const width = placeOf(station).length * LABEL.charWidth;

    const boxFor = ({ side, dy }: { side: LabelSide; dy: number }): Box => ({
      x1: side === 'left' ? x - LABEL.gap - width : x + LABEL.gap,
      x2: side === 'left' ? x - LABEL.gap : x + LABEL.gap + width,
      y1: y + dy - LABEL.above,
      y2: y + dy + LABEL.below,
    });
    const inView = (box: Box): boolean =>
      box.x1 >= VIEW.x &&
      box.x2 <= VIEW.x + VIEW.width &&
      box.y1 >= VIEW.y &&
      box.y2 <= VIEW.y + VIEW.height;
    const clash = (box: Box): number =>
      [...placed, ...dots].reduce((acc, other) => acc + overlapArea(box, other), 0);

    const candidates = LABEL_CANDIDATES.filter((candidate) => inView(boxFor(candidate)));
    const free = candidates.find((candidate) => clash(boxFor(candidate)) === 0);

    if (free) {
      placements.set(station.id, { ...free, hidden: false });
      placed.push(boxFor(free));
    } else if (mustShow(station)) {
      const least = [...candidates].sort((a, b) => clash(boxFor(a)) - clash(boxFor(b)))[0] ?? {
        side: 'left' as const,
        dy: 0,
      };
      placements.set(station.id, { ...least, hidden: false });
      placed.push(boxFor(least));
    } else {
      placements.set(station.id, { side: 'left', dy: 0, hidden: true });
    }
  }

  return placements;
}

function overlapArea(a: Box, b: Box): number {
  const width = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
  const height = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
  return width > 0 && height > 0 ? width * height : 0;
}
