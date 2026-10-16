import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Linha de referência horizontal, como um limiar de status. */
export interface ChartGuide {
  value: number;
  /** Rótulo curto; vazio desenha só a linha. */
  label: string;
}

interface ChartGeometry {
  line: string | null;
  area: string | null;
  last: { x: number; y: number } | null;
  guides: { y: number; label: string }[];
}

/**
 * Gráfico de linha mínimo para a evolução de uma leitura no streaming.
 *
 * Os pontos entram pela direita, como num monitor de sinais: com
 * `capacity`, a série ocupa só a fração do eixo que já foi coletada, em vez
 * de esticar três leituras pela largura inteira e sugerir uma tendência que
 * ainda não existe. A cor vem de `--tone` no elemento pai.
 */
@Component({
  selector: 'app-trend-chart',
  templateUrl: './trend-chart.component.html',
  styleUrl: './trend-chart.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrendChartComponent {
  readonly values = input.required<number[]>();
  readonly max = input.required<number>();
  readonly min = input(0);
  /** Quantidade de pontos que cabem no eixo; `null` usa o tamanho da série. */
  readonly capacity = input<number | null>(null);
  readonly guides = input<ChartGuide[]>([]);
  readonly filled = input(false);
  /** Descrição acessível do gráfico. */
  readonly label = input.required<string>();

  protected readonly geometry = computed<ChartGeometry>(() => {
    const values = this.values();
    const min = this.min();
    const span = Math.max(this.max() - min, Number.EPSILON);
    const capacity = Math.max(this.capacity() ?? values.length, values.length, 2);

    const y = (value: number): number => 100 - clamp(((value - min) / span) * 100, 0, 100);
    const x = (index: number): number =>
      ((capacity - values.length + index) / (capacity - 1)) * 100;

    const points = values.map((value, index) => ({ x: x(index), y: y(value) }));
    const line = points.length >= 2 ? points.map((p) => `${p.x},${p.y}`).join(' ') : null;
    const first = points[0];
    const last = points[points.length - 1] ?? null;

    return {
      line,
      area: line && first && last ? `${first.x},100 ${line} ${last.x},100` : null,
      last,
      guides: this.guides().map((guide) => ({ y: y(guide.value), label: guide.label })),
    };
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
