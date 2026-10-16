import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
  severityOf,
  severityToStatus,
} from '../../../../core/domain/use-cases/calculate-risk-xai.use-case';
import {
  RiskStatus,
  StationTelemetry,
  TelemetryVariable,
  VariableThreshold,
} from '../../../../core/domain/models/station-telemetry.model';
import { HISTORY_SIZE, TelemetrySample } from '../../../models/command-center.models';
import { formatDecimal, formatInteger, formatReading, formatTime } from '../../formatters';
import { ChartGuide, TrendChartComponent } from '../trend-chart/trend-chart.component';

export interface MeasurementView {
  variable: TelemetryVariable;
  label: string;
  value: string;
  unit: string;
  status: RiskStatus;
  /** Teto do eixo do gráfico, com folga acima do limiar máximo. */
  scaleMax: number;
  /** Limiares de atenção, alerta e máximo, desenhados como linhas de referência. */
  guides: ChartGuide[];
  /** Leituras recentes da grandeza, da mais antiga para a mais nova. */
  series: number[];
  /** Referência contra a qual a leitura é comparada. */
  reference: string;
  /** Leitura complementar que dá contexto ao número principal. */
  detail: string;
}

export interface StationReadingsView {
  coordinates: string;
  altitude: string;
  measuredAt: string;
  isOnline: boolean;
  measurements: MeasurementView[];
}

/**
 * Folga do eixo acima do limiar máximo. Sem ela, toda leitura crítica
 * encostaria no topo do gráfico e o operador não veria o quanto passou do
 * limite.
 */
const GAUGE_HEADROOM = 1.25;

/**
 * Leituras brutas dos sensores da estação em foco, cada uma na sua régua de
 * limiares. Fica abaixo do painel de risco de propósito: é a evidência que
 * sustenta a predição, consultada depois de saber quão grave é a situação.
 */
@Component({
  selector: 'app-station-monitor-grid',
  imports: [TrendChartComponent],
  templateUrl: './station-monitor-grid.component.html',
  styleUrl: './station-monitor-grid.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StationMonitorGridComponent {
  readonly station = input.required<StationTelemetry | null>();
  /** Leituras recentes da estação, da mais antiga para a mais nova. */
  readonly history = input<TelemetrySample[]>([]);

  protected readonly historyCapacity = HISTORY_SIZE;

  protected readonly readings = computed<StationReadingsView | null>(() => {
    const station = this.station();
    const history = this.history();
    if (!station) return null;

    const { latitude, longitude, altitude } = station.position;

    return {
      coordinates: `${formatDecimal(latitude, 4)}°, ${formatDecimal(longitude, 4)}°`,
      altitude: `${formatInteger(altitude)} m`,
      measuredAt: formatTime(station.measuredAt),
      isOnline: station.isOnline,
      measurements: [
        rainfallMeasurement(station),
        riverMeasurement(station),
        soilMeasurement(station),
        slopeMeasurement(station),
      ].map((measurement) => ({
        ...measurement,
        series:
          history.length > 0
            ? history.map((sample) => sample.readings[measurement.variable])
            : measurement.series,
      })),
    };
  });
}

function rainfallMeasurement(station: StationTelemetry): MeasurementView {
  const { accumulatedRainfall5d, rainfall24h } = station.readings;
  const threshold = station.thresholds.accumulatedRainfall5d;

  return {
    ...gauge('accumulatedRainfall5d', accumulatedRainfall5d, threshold, 'mm'),
    label: 'Chuva acumulada 5 dias',
    reference: `Limiar máximo ${formatReading(threshold.maximum)} mm`,
    detail: `Últimas 24h: ${formatReading(rainfall24h)} mm`,
  };
}

/**
 * A cota de transbordo é o limiar máximo da régua: é a partir dela que o rio
 * deixa a calha e entra na área urbana, e é ela que leva a estação a
 * ALERTA MÁXIMO pela escalada de protocolo.
 */
function riverMeasurement(station: StationTelemetry): MeasurementView {
  const { riverLevel } = station.readings;
  const threshold = station.thresholds.riverLevel;
  const margin = riverLevel - threshold.maximum;

  return {
    ...gauge('riverLevel', riverLevel, threshold, 'm', 2),
    label: 'Nível do rio',
    reference: `Cota de transbordo ${formatReading(threshold.maximum, 2)} m`,
    detail:
      margin >= 0
        ? `${formatDecimal(margin, 2)} m acima da cota`
        : `${formatDecimal(-margin, 2)} m até transbordar`,
  };
}

function soilMeasurement(station: StationTelemetry): MeasurementView {
  const { soilSaturation } = station.readings;
  const threshold = station.thresholds.soilSaturation;

  return {
    ...gauge('soilSaturation', soilSaturation, threshold, '%', 1, 100),
    label: 'Saturação do solo',
    reference: `Limiar crítico ${formatReading(threshold.maximum)}%`,
    detail: `Infiltração restante: ${formatReading(Math.max(0, 100 - soilSaturation))}%`,
  };
}

function slopeMeasurement(station: StationTelemetry): MeasurementView {
  const { slopeDisplacement } = station.readings;
  const threshold = station.thresholds.slopeDisplacement;

  return {
    ...gauge('slopeDisplacement', slopeDisplacement, threshold, 'mm/24h', 2),
    label: 'Inclinômetro de encosta',
    reference: `Ruptura provável ≥ ${formatReading(threshold.maximum)} mm/24h`,
    detail: `Limiar de alerta: ${formatReading(threshold.alert)} mm/24h`,
  };
}

/** Base comum às quatro grandezas: leitura, status isolado e limiares do gráfico. */
function gauge(
  variable: TelemetryVariable,
  value: number,
  threshold: VariableThreshold,
  unit: string,
  digits = 1,
  scaleMax = threshold.maximum * GAUGE_HEADROOM,
): Omit<MeasurementView, 'label' | 'reference' | 'detail'> {
  return {
    variable,
    value: formatReading(value, digits),
    unit,
    status: severityToStatus(severityOf(value, threshold)),
    scaleMax,
    guides: [
      { value: threshold.attention, label: '' },
      { value: threshold.alert, label: '' },
      { value: threshold.maximum, label: '' },
    ],
    series: [value],
  };
}
