import { TestBed } from '@angular/core/testing';
import { provideDataLayer } from '../../core/data/data.providers';
import { TelemetryRepository } from '../../core/domain/repositories/telemetry.repository';
import { ModalService } from '../../shared/ui/modal/modal.service';
import { EmergencyBriefingData } from '../models/command-center.models';
import { EmergencyBriefingComponent } from '../views/components/emergency-briefing/emergency-briefing.component';
import { AUTOMATIC_OPERATOR, CommandCenterFacade, MANUAL_OPERATOR } from './command-center.facade';

const MUCUM = 'EST-RS-62-MUCUM';
const JABOATAO = 'EST-PE-33-JABOATAO';

describe('CommandCenterFacade', () => {
  let facade: CommandCenterFacade;
  let repository: TelemetryRepository;
  let modal: ModalService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideDataLayer()] });
    facade = TestBed.inject(CommandCenterFacade);
    repository = TestBed.inject(TelemetryRepository);
    modal = TestBed.inject(ModalService);
  });

  afterEach(() => {
    facade.stopMonitoring();
    modal.closeAll();
    vi.useRealTimers();
    localStorage.clear();
  });

  it('seleciona a primeira estação por padrão e ignora id desconhecido', () => {
    expect(facade.selectedStation()?.id).toBe(MUCUM);

    facade.selectStation(JABOATAO);
    expect(facade.selectedStation()?.id).toBe(JABOATAO);

    facade.selectStation('EST-INEXISTENTE');
    expect(facade.selectedStation()?.id).toBe(JABOATAO);
  });

  it('expõe a predição completa com drivers ordenados por peso SHAP', () => {
    const assessment = facade.selectedAssessment();
    const weights = assessment?.drivers.map((driver) => driver.weight) ?? [];

    expect(assessment?.riskScore).toBe(facade.selectedStation()?.riskScore);
    expect(weights.reduce((a, b) => a + b, 0)).toBe(100);
    expect(weights).toEqual([...weights].sort((a, b) => b - a));
  });

  it('deriva os KPIs de sensores e de entrega da telemetria', () => {
    expect(facade.kpis().sensors).toMatchObject({ online: 45, total: 45, stationsOnline: 9 });
    expect(facade.kpis().delivery.rate).toBeNull();
    expect(facade.kpis().municipalities).toMatchObject({ monitored: 1500, target: 2500 });
    expect(facade.kpis().alertLeadTime).toMatchObject({ averageMs: 72_000, targetMs: 600_000 });

    repository.setStationOnline(JABOATAO, false);
    expect(facade.kpis().sensors).toMatchObject({ online: 40, total: 45, stationsOnline: 8 });
  });

  it('dispara, registra e abre a modal de emergência na tempestade extrema', async () => {
    vi.useFakeTimers();
    facade.selectStation(JABOATAO);

    const storm = facade.simulateExtremeStorm();

    expect(facade.selectedStation()?.status).toBe('ALERTA MÁXIMO');
    expect(facade.isDispatching()).toBe(true);

    const [dispatch] = facade.alertHistory();
    expect(dispatch.stationId).toBe(JABOATAO);
    expect(dispatch.triggeredBy).toBe('AUTOMATIC');
    expect(dispatch.operator).toBe(AUTOMATIC_OPERATOR);
    expect(dispatch.channels.map((c) => c.channel)).toEqual(['SIREN', 'PUSH', 'WHATSAPP', 'SMS']);

    const opened = modal.current()?.config;
    expect(opened?.severity).toBe('critical');
    expect(opened?.dismissible).toBe(false);
    expect(opened?.content).toBe(EmergencyBriefingComponent);

    const briefing = opened?.data as EmergencyBriefingData;
    expect(briefing.route?.code).toBe('R-33-02');
    expect(briefing.dispatch()?.id).toBe(dispatch.id);

    await vi.advanceTimersByTimeAsync(10_000);
    await storm;

    expect(facade.isDispatching()).toBe(false);
    expect(briefing.dispatch()?.responseTimeMs).not.toBeNull();
    expect(facade.kpis().delivery.attempted).toBe(4);
    expect(facade.kpis().alertLeadTime.lastDispatchMs).toBe(briefing.dispatch()?.responseTimeMs);
  });

  it('só dispara o alerta manual depois da confirmação, com a mensagem pré-visualizada', async () => {
    vi.useFakeTimers();
    facade.selectStation(MUCUM);
    expect(facade.canTriggerManualAlert()).toBe(true);

    const pending = facade.triggerManualAlert();
    const confirm = modal.current();
    expect(confirm?.config.title).toBe('Disparar alerta preventivo?');
    expect(facade.alertHistory()).toEqual([]);

    const action = confirm?.config.actions.find((a) => a.id === 'confirm');
    modal.runAction(confirm!.id, action!);
    await vi.advanceTimersByTimeAsync(10_000);
    await pending;

    const [dispatch] = facade.alertHistory();
    expect(dispatch.triggeredBy).toBe('MANUAL');
    expect(dispatch.operator).toBe(MANUAL_OPERATOR);
    expect(confirm?.config.message).toContain(dispatch.message);
  });

  it('não dispara quando o operador cancela', async () => {
    vi.useFakeTimers();

    const pending = facade.triggerManualAlert();
    const confirm = modal.current();
    modal.runAction(
      confirm!.id,
      confirm!.config.actions.find((a) => a.id === 'cancel')!,
    );
    await vi.advanceTimersByTimeAsync(1_000);
    await pending;

    expect(facade.alertHistory()).toEqual([]);
  });

  it('bloqueia o alerta manual abaixo de ATENÇÃO e explica o motivo', () => {
    facade.selectStation(JABOATAO);
    expect(facade.selectedStation()?.status).toBe('NORMAL');
    expect(facade.canTriggerManualAlert()).toBe(false);

    void facade.triggerManualAlert();

    expect(modal.current()?.config.title).toBe('Disparo preventivo indisponível');
    expect(facade.alertHistory()).toEqual([]);
  });

  it('reinicia estações, seleção e trilha de auditoria', async () => {
    vi.useFakeTimers();
    facade.selectStation(JABOATAO);
    const storm = facade.simulateExtremeStorm();
    await vi.advanceTimersByTimeAsync(10_000);
    await storm;

    facade.resetSimulation();

    expect(facade.alertHistory()).toEqual([]);
    expect(facade.selectedStation()?.id).toBe(MUCUM);
    expect(repository.findStation(JABOATAO)?.status).toBe('NORMAL');
  });

  it('acumula o histórico da estação em foco e registra mudanças de nível no diário', async () => {
    vi.useFakeTimers();
    facade.selectStation(JABOATAO);
    expect(facade.selectedHistory().length).toBe(1);
    expect(facade.watchLog()).toEqual([]);

    vi.advanceTimersByTime(5);
    const storm = facade.simulateExtremeStorm();

    const history = facade.selectedHistory();
    expect(history.length).toBe(2);
    expect(history.map((sample) => sample.status)).toEqual(['NORMAL', 'ALERTA MÁXIMO']);

    const kinds = facade.watchLog().map((event) => event.kind);
    expect(kinds).toContain('STATUS_CHANGE');
    expect(kinds).toContain('DISPATCH');
    expect(facade.watchLog().find((event) => event.kind === 'STATUS_CHANGE')?.description).toBe(
      'Nível passou de NORMAL para ALERTA MÁXIMO',
    );

    await vi.advanceTimersByTimeAsync(10_000);
    await storm;

    facade.resetSimulation();
    expect(facade.watchLog()).toEqual([]);
    expect(facade.selectedHistory().length).toBe(1);
  });

  it('ignora oscilação no limiar e registra o nível que se mantém por três leituras', () => {
    vi.useFakeTimers();
    const calm = { ...repository.findStation(JABOATAO)!.readings };
    const tense = { ...repository.findStation(MUCUM)!.readings };
    const read = (readings: typeof calm): void => {
      vi.advanceTimersByTime(5);
      repository.pushReading(MUCUM, readings);
      facade.watchLog();
    };

    facade.watchLog();
    expect(repository.findStation(MUCUM)?.status).toBe('ATENÇÃO');

    read(calm);
    read(tense);
    read(calm);
    read(tense);
    expect(facade.watchLog()).toEqual([]);

    read(calm);
    read(calm);
    expect(facade.watchLog()).toEqual([]);

    read(calm);
    expect(facade.watchLog().map((event) => event.description)).toEqual([
      'Nível passou de ATENÇÃO para NORMAL',
    ]);
  });

  it('reflete o estado de sincronização do PWA', () => {
    expect(facade.syncStatus()).toMatchObject({ isOnline: true, pendingDispatches: 0 });

    facade.startMonitoring();
    expect(facade.syncStatus().isStreaming).toBe(true);

    facade.stopMonitoring();
    expect(facade.syncStatus().isStreaming).toBe(false);
  });
});
