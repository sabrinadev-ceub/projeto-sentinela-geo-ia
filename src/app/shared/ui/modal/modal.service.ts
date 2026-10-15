import { Injectable, Injector, Signal, computed, inject, signal } from '@angular/core';
import {
  MODAL_DATA,
  MODAL_EXIT_DURATION_MS,
  MODAL_REF,
  MODAL_SEVERITY_ICONS,
  ModalAction,
  ModalConfig,
  ModalInstance,
  ModalRef,
  ModalResult,
  ResolvedModalConfig,
} from './modal.model';

/** Config de confirmação: as ações são derivadas dos rótulos. */
export interface ModalConfirmConfig extends Omit<ModalConfig, 'actions'> {
  confirmLabel?: string;
  cancelLabel?: string;
  confirmIcon?: string;
}

/** Config de aviso: uma única ação de reconhecimento. */
export interface ModalAlertConfig extends Omit<ModalConfig, 'actions'> {
  acknowledgeLabel?: string;
}

/**
 * Controla a pilha de modais por Signals.
 *
 * A pilha é um array e não um único modal porque um alerta crítico pode nascer
 * sobre um diálogo já aberto: o `<dialog>` nativo empilha na top layer, e
 * fechar o de cima devolve o foco ao de baixo sem trabalho extra.
 *
 * Todo fechamento passa por `close()`, que marca `closing` e só remove o
 * registro depois de `MODAL_EXIT_DURATION_MS`. Com isso a animação de saída
 * vale para ESC, backdrop, botão de ação e fechamento programático — nenhum
 * caminho some da tela sem transição.
 */
@Injectable({ providedIn: 'root' })
export class ModalService {
  private readonly parentInjector = inject(Injector);

  private readonly _stack = signal<ModalInstance[]>([]);
  private readonly resolvers = new Map<string, (result: ModalResult) => void>();

  private sequence = 0;

  readonly stack: Signal<ModalInstance[]> = this._stack.asReadonly();

  readonly isOpen = computed(() => this._stack().some((modal) => !modal.closing));

  /** Modal do topo, o único que recebe interação. */
  readonly current = computed<ModalInstance | null>(() => {
    const stack = this._stack();
    return stack.length > 0 ? (stack[stack.length - 1] ?? null) : null;
  });

  open<TData = unknown>(config: ModalConfig<TData>): ModalRef {
    const id = `modal-${++this.sequence}`;

    let resolve!: (result: ModalResult) => void;
    const closed = new Promise<ModalResult>((done) => {
      resolve = done;
    });
    this.resolvers.set(id, resolve);

    const ref: ModalRef = {
      id,
      closed,
      close: (actionId = null) => this.close(id, actionId, actionId === null),
    };

    const resolved = this.resolve(config);
    const instance: ModalInstance<TData> = {
      id,
      config: resolved,
      injector: Injector.create({
        parent: this.parentInjector,
        providers: [
          { provide: MODAL_DATA, useValue: resolved.data },
          { provide: MODAL_REF, useValue: ref },
        ],
      }),
      closing: false,
    };

    this._stack.update((stack) => [...stack, instance as ModalInstance]);
    return ref;
  }

  /** Resolve `true` apenas quando a ação de confirmação é acionada. */
  async confirm(config: ModalConfirmConfig): Promise<boolean> {
    const { confirmLabel, cancelLabel, confirmIcon, ...rest } = config;
    const severity = rest.severity ?? 'warning';

    const ref = this.open({
      ...rest,
      severity,
      actions: [
        { id: 'cancel', label: cancelLabel ?? 'Cancelar', variant: 'text' },
        {
          id: 'confirm',
          label: confirmLabel ?? 'Confirmar',
          variant: severity === 'danger' || severity === 'critical' ? 'danger' : 'filled',
          icon: confirmIcon,
          autoFocus: true,
        },
      ],
    });

    const result = await ref.closed;
    return result.actionId === 'confirm';
  }

  async alert(config: ModalAlertConfig): Promise<void> {
    const { acknowledgeLabel, ...rest } = config;

    const ref = this.open({
      ...rest,
      severity: rest.severity ?? 'info',
      actions: [
        { id: 'ok', label: acknowledgeLabel ?? 'Entendi', variant: 'filled', autoFocus: true },
      ],
    });

    await ref.closed;
  }

  /**
   * Alerta crítico de emergência: severidade `critical`, sem dispensa por ESC
   * ou backdrop. Exigir uma decisão explícita é o ponto — um disparo à
   * população não pode ser cancelado por clique acidental fora do painel.
   */
  emergency(config: ModalConfirmConfig): Promise<boolean> {
    return this.confirm({
      ...config,
      severity: 'critical',
      size: config.size ?? 'md',
      dismissible: config.dismissible ?? false,
      confirmLabel: config.confirmLabel ?? 'Acionar Defesa Civil',
      cancelLabel: config.cancelLabel ?? 'Agora não',
      confirmIcon: config.confirmIcon ?? 'siren',
    });
  }

  /** Dispensa por ESC, backdrop ou botão de fechar. */
  dismiss(id: string): void {
    this.close(id, null, true);
  }

  close(id: string, actionId: string | null = null, dismissed = false): void {
    const target = this._stack().find((modal) => modal.id === id);
    if (!target || target.closing) return;

    this._stack.update((stack) =>
      stack.map((modal) => (modal.id === id ? { ...modal, closing: true } : modal)),
    );

    setTimeout(() => {
      this._stack.update((stack) => stack.filter((modal) => modal.id !== id));
      this.resolvers.get(id)?.({ actionId, dismissed });
      this.resolvers.delete(id);
    }, MODAL_EXIT_DURATION_MS);
  }

  closeAll(): void {
    for (const modal of this._stack()) this.close(modal.id, null, true);
  }

  /** Executa a ação e fecha, a menos que ela peça para manter o modal aberto. */
  runAction(id: string, action: ModalAction): void {
    action.handler?.();
    if (action.closeOnClick === false) return;

    this.close(id, action.id, false);
  }

  private resolve<TData>(config: ModalConfig<TData>): ResolvedModalConfig<TData> {
    const severity = config.severity ?? 'neutral';

    return {
      title: config.title,
      message: config.message ?? null,
      overline: config.overline ?? null,
      severity,
      size: config.size ?? 'sm',
      icon: config.icon ?? MODAL_SEVERITY_ICONS[severity],
      details: config.details ?? [],
      actions: config.actions ?? [],
      dismissible: config.dismissible ?? true,
      content: config.content ?? null,
      data: config.data ?? null,
    };
  }
}
