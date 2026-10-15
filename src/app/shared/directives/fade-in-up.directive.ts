import { Directive, input } from '@angular/core';

/**
 * Entrada em cascata de cards, linhas de tabela e itens de lista.
 *
 * `delay` é o índice do item, não um tempo: a conversão para ms fica no CSS
 * (`calc(var(--delay) * 80ms)`), de forma que ajustar o ritmo da cascata é
 * mexer em uma linha de `_animations.scss`, não em cada template.
 */
@Directive({
  selector: '[appFadeInUp]',
  host: {
    class: 'fade-in-up',
    '[style.--delay]': 'delay()',
  },
})
export class FadeInUpDirective {
  readonly delay = input<number, number | string>(0, {
    transform: (v) => Number(v) || 0,
  });
}
