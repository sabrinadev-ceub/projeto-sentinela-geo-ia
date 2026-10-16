import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { SCORE_BANDS } from '../../../../core/constants/risk-thresholds';
import { RiskAssessment } from '../../../../core/domain/models/risk-assessment.model';
import {
  RiskStatus,
  StationTelemetry,
  TelemetryVariable,
} from '../../../../core/domain/models/station-telemetry.model';
import { HISTORY_SIZE, TelemetrySample } from '../../../models/command-center.models';
import { formatReading, formatTime } from '../../formatters';
import { ChartGuide, TrendChartComponent } from '../trend-chart/trend-chart.component';

export interface ShapBarView {
  variable: TelemetryVariable;
  label: string;
  /** Peso SHAP exato em %, como publicado pelo modelo. */
  weight: number;
  /** Largura da barra de 0 a 100, relativa ao fator dominante. */
  width: number;
  reading: string;
  status: RiskStatus;
  isDominant: boolean;
}

export interface ScoreBandView {
  label: string;
  status: RiskStatus;
  /** Início da faixa na escala de 0 a 100. */
  from: number;
  /** Largura da faixa na escala de 0 a 100. */
  width: number;
}

/** Faixas de pontuação do modelo, na ordem em que aparecem na régua. */
const SCORE_SCALE: ScoreBandView[] = [
  { label: 'Normal', status: 'NORMAL', from: 0, width: SCORE_BANDS.attention },
  {
    label: 'Atenção',
    status: 'ATENÇÃO',
    from: SCORE_BANDS.attention,
    width: SCORE_BANDS.alert - SCORE_BANDS.attention,
  },
  {
    label: 'Alerta',
    status: 'ALERTA',
    from: SCORE_BANDS.alert,
    width: SCORE_BANDS.maximum - SCORE_BANDS.alert,
  },
  {
    label: 'Máximo',
    status: 'ALERTA MÁXIMO',
    from: SCORE_BANDS.maximum,
    width: 100 - SCORE_BANDS.maximum,
  },
];

/** Limiares de pontuação desenhados no gráfico de evolução. */
const SCORE_GUIDES: ChartGuide[] = [
  { value: SCORE_BANDS.attention, label: String(SCORE_BANDS.attention) },
  { value: SCORE_BANDS.alert, label: String(SCORE_BANDS.alert) },
  { value: SCORE_BANDS.maximum, label: String(SCORE_BANDS.maximum) },
];

/**
 * Painel de foco da estação ativa: probabilidade de risco, explicação SHAP da
 * predição e disparo manual. É o bloco de maior peso visual da tela porque
 * responde a "quão grave é, por quê e o que faço".
 *
 * Componente puro: o pedido de disparo sobe por `manualAlertRequested`, e a
 * decisão de abrir a confirmação é do Facade.
 */
@Component({
  selector: 'app-xai-shap-panel',
  imports: [TrendChartComponent],
  templateUrl: './xai-shap-panel.component.html',
  styleUrl: './xai-shap-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class XaiShapPanelComponent {
  readonly station = input.required<StationTelemetry | null>();
  readonly assessment = input.required<RiskAssessment | null>();
  readonly canTriggerAlert = input.required<boolean>();
  readonly isDispatching = input(false);
  /** Leituras recentes da estação, da mais antiga para a mais nova. */
  readonly history = input<TelemetrySample[]>([]);

  readonly manualAlertRequested = output<void>();

  protected readonly scale = SCORE_SCALE;
  protected readonly scoreGuides = SCORE_GUIDES;
  protected readonly historyCapacity = HISTORY_SIZE;

  protected readonly riskSeries = computed(() => this.history().map((sample) => sample.riskScore));

  /** Início da janela do gráfico, para o operador saber quanto tempo ele cobre. */
  protected readonly historySince = computed(() => formatTime(this.history()[0]?.at ?? null));

  protected readonly bars = computed<ShapBarView[]>(() => {
    const assessment = this.assessment();
    if (!assessment) return [];

    const dominant = Math.max(1, ...assessment.drivers.map((driver) => driver.weight));

    return assessment.drivers.map((driver, index) => ({
      variable: driver.variable,
      label: driver.label,
      weight: driver.weight,
      width: (driver.weight / dominant) * 100,
      reading: `${formatReading(driver.value, 2)}${driver.unit === '%' ? '' : ' '}${driver.unit}`,
      status: driver.status,
      isDominant: index === 0,
    }));
  });

  protected readonly weightSum = computed(() =>
    this.bars().reduce((acc, bar) => acc + bar.weight, 0),
  );

  /** Explica por que o botão está desabilitado: um botão inerte sem motivo é um beco sem saída. */
  protected readonly triggerHint = computed<string>(() => {
    if (this.isDispatching()) return 'Difusão em andamento. Aguarde a resposta dos canais.';

    const assessment = this.assessment();
    if (!assessment) return 'Selecione uma estação.';
    if (!this.canTriggerAlert()) {
      return 'Disponível a partir do nível ATENÇÃO, para não banalizar o alerta.';
    }
    return 'Abre a confirmação com a mensagem exata enviada à população.';
  });

  protected requestManualAlert(): void {
    if (this.canTriggerAlert()) this.manualAlertRequested.emit();
  }
}
