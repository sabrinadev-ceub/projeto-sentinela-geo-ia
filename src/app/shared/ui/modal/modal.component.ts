import { NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  viewChildren,
} from '@angular/core';
import { ModalAction, ModalInstance } from './modal.model';
import { ModalService } from './modal.service';

/**
 * Host único da pilha de modais. Fica montado uma vez no shell do app e
 * renderiza o que `ModalService` publicar.
 *
 * Cada modal é um `<dialog>` nativo aberto por `showModal()`, o que entrega de
 * graça a top layer, o backdrop, o focus trap e o ESC — nada disso é
 * reimplementado aqui, e é por isso que o sistema não precisa de biblioteca de
 * UI externa.
 */
@Component({
  selector: 'app-modal',
  imports: [NgComponentOutlet],
  templateUrl: './modal.component.html',
  styleUrl: './modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ModalComponent {
  private readonly modalService = inject(ModalService);

  protected readonly modals = this.modalService.stack;

  private readonly dialogs = viewChildren<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    // `dialogs()` é signal: o efeito reroda quando um `<dialog>` entra na view.
    effect(() => {
      for (const ref of this.dialogs()) {
        const element = ref.nativeElement;
        if (!element.open) element.showModal();
      }
    });
  }

  /**
   * ESC. O `preventDefault` é obrigatório: deixar o navegador fechar removeria
   * o elemento antes da animação de saída e sem resolver a promessa do modal.
   */
  protected onCancel(event: Event, modal: ModalInstance): void {
    event.preventDefault();
    if (modal.config.dismissible) this.modalService.dismiss(modal.id);
  }

  /** Clique no backdrop: só o próprio `<dialog>` é alvo, o painel não. */
  protected onBackdropClick(event: MouseEvent, modal: ModalInstance): void {
    if (!modal.config.dismissible) return;
    if (event.target === event.currentTarget) this.modalService.dismiss(modal.id);
  }

  protected dismiss(modal: ModalInstance): void {
    this.modalService.dismiss(modal.id);
  }

  protected runAction(modal: ModalInstance, action: ModalAction): void {
    this.modalService.runAction(modal.id, action);
  }
}
