import { TestBed } from '@angular/core/testing';
import { MODAL_DATA, MODAL_EXIT_DURATION_MS, MODAL_REF, ModalRef } from './modal.model';
import { ModalService } from './modal.service';

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, MODAL_EXIT_DURATION_MS + 20));
}

describe('ModalService', () => {
  let service: ModalService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ModalService);
  });

  it('empilha e desempilha modais', async () => {
    const first = service.open({ title: 'Primeiro' });
    const second = service.open({ title: 'Segundo' });

    expect(service.stack().length).toBe(2);
    expect(service.current()?.id).toBe(second.id);
    expect(service.isOpen()).toBe(true);

    service.close(second.id);
    await settle();

    expect(service.stack().length).toBe(1);
    expect(service.current()?.id).toBe(first.id);
  });

  it('aplica os padrões de configuração', () => {
    service.open({ title: 'Padrões' });
    const config = service.current()?.config;

    expect(config?.severity).toBe('neutral');
    expect(config?.size).toBe('sm');
    expect(config?.icon).toBe('help');
    expect(config?.dismissible).toBe(true);
    expect(config?.details).toEqual([]);
    expect(config?.actions).toEqual([]);
  });

  it('deriva o ícone da severidade e aceita sobrescrita', () => {
    service.open({ title: 'Crítico', severity: 'critical' });
    expect(service.current()?.config.icon).toBe('crisis_alert');

    service.open({ title: 'Customizado', severity: 'critical', icon: 'flood' });
    expect(service.current()?.config.icon).toBe('flood');
  });

  it('mantém o elemento na pilha durante a animação de saída', async () => {
    const ref = service.open({ title: 'Saindo' });

    service.close(ref.id);
    expect(service.stack().length).toBe(1);
    expect(service.current()?.closing).toBe(true);
    expect(service.isOpen()).toBe(false);

    await settle();
    expect(service.stack().length).toBe(0);
  });

  it('ignora fechamento repetido do mesmo modal', async () => {
    const ref = service.open({ title: 'Idempotente' });

    service.close(ref.id, 'ok');
    service.close(ref.id, 'outro');

    expect(await ref.closed).toEqual({ actionId: 'ok', dismissed: false });
  });

  it('resolve a promessa com a ação acionada', async () => {
    const ref = service.open({
      title: 'Com ações',
      actions: [{ id: 'enviar', label: 'Enviar' }],
    });

    service.runAction(ref.id, { id: 'enviar', label: 'Enviar' });

    expect(await ref.closed).toEqual({ actionId: 'enviar', dismissed: false });
  });

  it('mantém o modal aberto para ação com closeOnClick falso', () => {
    let calls = 0;
    const ref = service.open({ title: 'Persistente' });

    service.runAction(ref.id, {
      id: 'recalcular',
      label: 'Recalcular',
      closeOnClick: false,
      handler: () => calls++,
    });

    expect(calls).toBe(1);
    expect(service.stack().length).toBe(1);
    expect(service.current()?.closing).toBe(false);
  });

  it('marca dispensa por ESC ou backdrop', async () => {
    const ref = service.open({ title: 'Dispensável' });

    service.dismiss(ref.id);

    expect(await ref.closed).toEqual({ actionId: null, dismissed: true });
  });

  it('resolve confirm como verdadeiro apenas na ação de confirmação', async () => {
    const confirmed = service.confirm({ title: 'Confirmar?' });
    const confirmId = service.current()!.id;
    service.runAction(confirmId, { id: 'confirm', label: 'Confirmar' });
    expect(await confirmed).toBe(true);

    const cancelled = service.confirm({ title: 'Confirmar?' });
    const cancelId = service.current()!.id;
    service.dismiss(cancelId);
    expect(await cancelled).toBe(false);
  });

  it('configura o alerta de emergência como crítico e não dispensável', () => {
    service.emergency({ title: 'Evacuação imediata' });
    const config = service.current()!.config;

    expect(config.severity).toBe('critical');
    expect(config.dismissible).toBe(false);
    expect(config.actions.map((a) => a.id)).toEqual(['cancel', 'confirm']);
    expect(config.actions[1].variant).toBe('danger');
    expect(config.actions[1].icon).toBe('siren');
  });

  it('injeta MODAL_DATA e MODAL_REF no conteúdo projetado', () => {
    const payload = { stationId: 'EST-RS-62-MUCUM' };
    const ref = service.open({ title: 'Dinâmico', data: payload });
    const injector = service.current()!.injector;

    expect(injector.get(MODAL_DATA)).toBe(payload);
    expect(injector.get<ModalRef>(MODAL_REF).id).toBe(ref.id);
  });

  it('fecha toda a pilha', async () => {
    service.open({ title: 'A' });
    service.open({ title: 'B' });
    service.open({ title: 'C' });

    service.closeAll();
    await settle();

    expect(service.stack()).toEqual([]);
    expect(service.isOpen()).toBe(false);
  });
});
