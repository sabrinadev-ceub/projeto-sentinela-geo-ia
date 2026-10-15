import { InjectionToken, Injector, Type } from '@angular/core';

/** Variantes de severidade. `critical` é a de emergência: ganha halo pulsante. */
export type ModalSeverity = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'critical';

export type ModalSize = 'sm' | 'md' | 'lg';

export type ModalActionVariant = 'filled' | 'tonal' | 'text' | 'danger';

/** Botão de ação do rodapé. */
export interface ModalAction {
  /** Identificador devolvido em `ModalResult.actionId`. */
  id: string;
  label: string;
  variant?: ModalActionVariant;
  icon?: string;
  /** Recebe o foco ao abrir. Apenas a primeira ação marcada é considerada. */
  autoFocus?: boolean;
  /** `false` mantém o modal aberto depois do clique. Padrão: `true`. */
  closeOnClick?: boolean;
  /** Executado antes do fechamento. */
  handler?: () => void;
}

/** Linha de dado em destaque, usada para a ficha técnica do alerta. */
export interface ModalDetail {
  label: string;
  value: string;
  /** Realça o valor, para o número que motiva a decisão. */
  emphasis?: boolean;
}

export interface ModalConfig<TData = unknown> {
  title: string;
  /** Corpo em texto puro. Ignorado quando `content` é informado. */
  message?: string;
  /** Linha sobreposta ao título, para protocolo ou bacia. */
  overline?: string;
  severity?: ModalSeverity;
  size?: ModalSize;
  /** Sobrescreve o ícone padrão da severidade. */
  icon?: string;
  details?: ModalDetail[];
  actions?: ModalAction[];
  /** `false` trava ESC, backdrop e botão de fechar — para alerta que exige decisão. */
  dismissible?: boolean;
  /** Componente projetado no corpo, recebendo `MODAL_DATA` e `MODAL_REF`. */
  content?: Type<unknown>;
  data?: TData;
}

/** Config com todos os padrões já aplicados: é o que o componente renderiza. */
export interface ResolvedModalConfig<TData = unknown> {
  title: string;
  message: string | null;
  overline: string | null;
  severity: ModalSeverity;
  size: ModalSize;
  icon: string;
  details: ModalDetail[];
  actions: ModalAction[];
  dismissible: boolean;
  content: Type<unknown> | null;
  data: TData | null;
}

export interface ModalResult {
  /** Id da ação clicada; `null` quando o modal foi apenas dispensado. */
  actionId: string | null;
  /** `true` para ESC, backdrop ou botão de fechar. */
  dismissed: boolean;
}

/** Modal na pilha. `closing` mantém o elemento no DOM durante a animação de saída. */
export interface ModalInstance<TData = unknown> {
  id: string;
  config: ResolvedModalConfig<TData>;
  injector: Injector;
  closing: boolean;
}

/** Handle devolvido por `ModalService.open`. */
export interface ModalRef {
  readonly id: string;
  /** Resolve quando a animação de saída termina. */
  readonly closed: Promise<ModalResult>;
  close(actionId?: string | null): void;
}

/** Dados passados ao componente projetado em `config.content`. */
export const MODAL_DATA = new InjectionToken<unknown>('MODAL_DATA');

/** Handle do próprio modal, para o conteúdo projetado se fechar. */
export const MODAL_REF = new InjectionToken<ModalRef>('MODAL_REF');

/**
 * Deve casar com a duração das animações de saída em `modal.component.scss`:
 * encurtar aqui corta a animação, alongar deixa o modal inerte na tela.
 */
export const MODAL_EXIT_DURATION_MS = 220;

/** Ícone padrão por severidade. */
export const MODAL_SEVERITY_ICONS: Record<ModalSeverity, string> = {
  neutral: 'help',
  info: 'info',
  success: 'check_circle',
  warning: 'warning',
  danger: 'error',
  critical: 'crisis_alert',
};
