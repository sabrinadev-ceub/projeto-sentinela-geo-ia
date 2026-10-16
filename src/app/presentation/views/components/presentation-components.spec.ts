import { TestBed } from '@angular/core/testing';
import { provideDataLayer } from '../../../core/data/data.providers';
import { AlertDispatch } from '../../../core/domain/models/alert-dispatch.model';
import { StationTelemetry } from '../../../core/domain/models/station-telemetry.model';
import { TelemetryRepository } from '../../../core/domain/repositories/telemetry.repository';
import { CalculateRiskXaiUseCase } from '../../../core/domain/use-cases/calculate-risk-xai.use-case';
import { CommandCenterKpis } from '../../models/command-center.models';
import { AlertAuditTableComponent } from './alert-audit-table/alert-audit-table.component';
import { KpiSummaryBarComponent } from './kpi-summary-bar/kpi-summary-bar.component';
import { StationMonitorGridComponent } from './station-monitor-grid/station-monitor-grid.component';
import { NetworkStatusBarComponent } from './network-status-bar/network-status-bar.component';
import { StationMapComponent } from './station-map/station-map.component';
import { StationSelectorComponent } from './station-selector/station-selector.component';
import { TrendChartComponent } from './trend-chart/trend-chart.component';
import { WatchLogComponent } from './watch-log/watch-log.component';
import { XaiShapPanelComponent } from './xai-shap-panel/xai-shap-panel.component';

const KPIS: CommandCenterKpis = {
  municipalities: { monitored: 1500, target: 2500, goalCode: '2.2.4', horizon: '2025-2035' },
  sensors: { online: 15, total: 15, stationsOnline: 3, stationsTotal: 3, network: 'LoRaWAN' },
  alertLeadTime: { averageMs: 72_000, targetMs: 600_000, lastDispatchMs: null },
  delivery: { rate: null, delivered: 0, attempted: 0, acknowledged: 0, recipients: 0 },
};

function text(element: Element | null): string {
  return element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

describe('Componentes de apresentação', () => {
  let stations: StationTelemetry[];

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideDataLayer()] });
    stations = TestBed.inject(TelemetryRepository).stations();
  });

  afterEach(() => localStorage.clear());

  it('KpiSummaryBar renderiza os quatro KPIs da Meta 2.2.4', async () => {
    const fixture = TestBed.createComponent(KpiSummaryBarComponent);
    fixture.componentRef.setInput('kpis', KPIS);
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    const cards = host.querySelectorAll('.kpi');

    expect(cards.length).toBe(4);
    expect(text(cards[0])).toContain('1.500');
    expect(text(cards[0])).toContain('/ 2.500');
    expect(text(cards[1])).toContain('LoRaWAN');
    expect(text(cards[2])).toContain('1m12s');
    expect(text(cards[2])).toContain('meta ≤ 10 min');
    expect(text(cards[3].querySelector('.kpi__number'))).toBe('-');
  });

  it('StationSelector marca a estação em foco e emite a seleção', async () => {
    const fixture = TestBed.createComponent(StationSelectorComponent);
    fixture.componentRef.setInput('stations', stations);
    fixture.componentRef.setInput('selectedStationId', stations[0].id);
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    const options = host.querySelectorAll<HTMLButtonElement>('.option');
    expect(options.length).toBe(stations.length);
    expect(options[0].getAttribute('aria-pressed')).toBe('true');
    expect(text(options[0].querySelector('.option__code'))).toBe(stations[0].id);

    const selected: string[] = [];
    fixture.componentInstance.stationSelected.subscribe((id) => selected.push(id));
    options[2].click();

    expect(selected).toEqual([stations[2].id]);
  });

  it('NetworkStatusBar destaca o nível mais grave e a conduta do protocolo', async () => {
    const fixture = TestBed.createComponent(NetworkStatusBarComponent);
    fixture.componentRef.setInput('stations', stations);
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    const bar = host.querySelector('.bar');
    expect(bar?.getAttribute('data-status')).toBe('ATENÇÃO');
    expect(text(host.querySelector('.bar__headline'))).toBe(
      'ATENÇÃO em 5 estações: Muçum, Petrópolis, Blumenau, São Sebastião e Rio Branco',
    );
    expect(text(host.querySelector('.bar__guidance'))).toBe('Acompanhar a evolução das leituras.');
    expect([...host.querySelectorAll('.bar__counts li')].map(text)).toEqual([
      '5 ATENÇÃO',
      '4 NORMAL',
    ]);
  });

  it('StationMap posiciona cada estação na coordenada real e emite a seleção', async () => {
    const fixture = TestBed.createComponent(StationMapComponent);
    fixture.componentRef.setInput('stations', stations);
    fixture.componentRef.setInput('selectedStationId', stations[1].id);
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    const markers = host.querySelectorAll<SVGGElement>('.marker');
    expect(markers.length).toBe(stations.length);

    const dot = markers[0].querySelector('.marker__dot');
    expect(Number(dot?.getAttribute('cx'))).toBe(stations[0].position.longitude);
    expect(Number(dot?.getAttribute('cy'))).toBe(-stations[0].position.latitude);
    expect(markers[1].getAttribute('aria-pressed')).toBe('true');
    expect(markers[1].querySelector('.marker__ring')).not.toBeNull();

    const selected: string[] = [];
    fixture.componentInstance.stationSelected.subscribe((id) => selected.push(id));
    markers[2].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(selected).toEqual([stations[2].id]);
  });

  it('TrendChart preenche o eixo pela direita conforme a capacidade', async () => {
    const fixture = TestBed.createComponent(TrendChartComponent);
    fixture.componentRef.setInput('values', [0, 50, 100]);
    fixture.componentRef.setInput('max', 100);
    fixture.componentRef.setInput('capacity', 5);
    fixture.componentRef.setInput('label', 'teste');
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.chart__line')?.getAttribute('points')).toBe('50,100 75,50 100,0');

    fixture.componentRef.setInput('values', [40]);
    await fixture.whenStable();
    expect(host.querySelector('.chart__line')).toBeNull();
    expect(host.querySelector('.chart__dot')).not.toBeNull();
  });

  it('WatchLog lista os eventos com hora e mostra estado vazio sem eventos', async () => {
    const fixture = TestBed.createComponent(WatchLogComponent);
    fixture.componentRef.setInput('events', []);
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    expect(text(host.querySelector('.log__empty'))).toContain('Nenhuma mudança de nível');

    fixture.componentRef.setInput('events', [
      {
        id: 'e1',
        kind: 'STATUS_CHANGE',
        at: new Date().toISOString(),
        stationName: stations[0].name,
        status: 'ALERTA MÁXIMO',
        description: 'Nível passou de ATENÇÃO para ALERTA MÁXIMO',
      },
    ]);
    await fixture.whenStable();

    const entry = host.querySelector('.entry');
    expect(entry?.getAttribute('data-status')).toBe('ALERTA MÁXIMO');
    expect(text(entry)).toContain('Nível passou de ATENÇÃO para ALERTA MÁXIMO');
    expect(text(entry?.querySelector('.entry__time') ?? null)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('StationMonitorGrid mostra as quatro grandezas da estação em foco', async () => {
    const fixture = TestBed.createComponent(StationMonitorGridComponent);
    fixture.componentRef.setInput('station', stations[0]);
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    const labels = [...host.querySelectorAll('.measure__label')].map(text);

    expect(labels).toEqual([
      'Chuva acumulada 5 dias',
      'Nível do rio',
      'Saturação do solo',
      'Inclinômetro de encosta',
    ]);
    expect(text(host)).toContain('Cota de transbordo 19 m');
    expect(text(host)).toContain('Últimas 24h: 34 mm');

    fixture.componentRef.setInput('station', null);
    await fixture.whenStable();
    expect(host.querySelector('.measure')).toBeNull();
  });

  it('XaiShapPanel exibe uma barra SHAP por variável e emite o pedido de disparo', async () => {
    const assessment = TestBed.inject(CalculateRiskXaiUseCase).execute(stations[0]);
    const fixture = TestBed.createComponent(XaiShapPanelComponent);
    fixture.componentRef.setInput('station', stations[0]);
    fixture.componentRef.setInput('assessment', assessment);
    fixture.componentRef.setInput('canTriggerAlert', true);
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll('.bar').length).toBe(assessment.drivers.length);
    expect(text(host.querySelector('.shap__sum'))).toBe('Σ 100%');

    let requests = 0;
    fixture.componentInstance.manualAlertRequested.subscribe(() => requests++);
    host.querySelector<HTMLButtonElement>('.xai__trigger')?.click();
    expect(requests).toBe(1);

    fixture.componentRef.setInput('canTriggerAlert', false);
    await fixture.whenStable();
    expect(host.querySelector<HTMLButtonElement>('.xai__trigger')?.disabled).toBe(true);
  });

  it('AlertAuditTable mostra estado vazio e as linhas de disparo', async () => {
    const fixture = TestBed.createComponent(AlertAuditTableComponent);
    fixture.componentRef.setInput('dispatches', []);
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    expect(text(host.querySelector('.audit__empty'))).toContain('Nenhum disparo registrado');

    const dispatch: AlertDispatch = {
      id: 'd1',
      protocol: 'SGI-2026-000001',
      stationId: stations[0].id,
      stationName: stations[0].name,
      basinCode: '62',
      status: 'ALERTA MÁXIMO',
      riskScore: 100,
      shapValues: stations[0].shapValues,
      message: 'teste',
      channels: [
        {
          channel: 'SIREN',
          status: 'DELIVERED',
          recipients: 4528,
          acknowledged: 3170,
          latencyMs: 380,
          dispatchedAt: new Date().toISOString(),
          error: null,
        },
        {
          channel: 'SMS',
          status: 'FAILED',
          recipients: 3717,
          acknowledged: 0,
          latencyMs: 4500,
          dispatchedAt: new Date().toISOString(),
          error: 'Gateway do canal não confirmou a entrega.',
        },
      ],
      populationNotified: 4528,
      operator: 'Motor Sentinela GeoIA',
      triggeredBy: 'AUTOMATIC',
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      responseTimeMs: 4500,
      syncState: 'SYNCED',
    };

    fixture.componentRef.setInput('dispatches', [dispatch]);
    await fixture.whenStable();

    const row = host.querySelector('tr.mat-mdc-row');
    expect(text(row)).toContain('SGI-2026-000001');
    expect(text(row)).toContain('Automático');
    expect(text(row)).toContain('4.528');
    expect(row?.querySelector('.latency')?.getAttribute('data-tone')).toBe('normal');
    expect(row?.querySelectorAll('.channel').length).toBe(2);
    expect(row?.querySelector('.channel[data-tone="danger"]')).not.toBeNull();
  });
});
