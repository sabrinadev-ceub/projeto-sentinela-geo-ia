import { TestBed } from '@angular/core/testing';
import { TelemetryRepository } from '../../domain/repositories/telemetry.repository';
import { provideDataLayer } from '../data.providers';
import { MockTelemetryRepository } from './mock-telemetry.repository';

describe('MockTelemetryRepository', () => {
  let repository: MockTelemetryRepository;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideDataLayer()] });
    repository = TestBed.inject(MockTelemetryRepository);
  });

  afterEach(() => {
    repository.stopStream();
    localStorage.clear();
  });

  it('resolve o contrato de domínio pela inversão de dependência', () => {
    expect(TestBed.inject(TelemetryRepository)).toBe(repository);
  });

  it('semeia nove estações nas cinco regiões do país', () => {
    expect(repository.stations().map((s) => s.basin.state)).toEqual([
      'RS',
      'RJ',
      'PE',
      'SC',
      'SP',
      'MG',
      'AC',
      'AM',
      'MT',
    ]);
    expect(new Set(repository.stations().map((s) => s.basin.region))).toEqual(
      new Set(['Sul', 'Sudeste', 'Nordeste', 'Norte', 'Centro-Oeste']),
    );
  });

  it('materializa a predição de cada estação semeada', () => {
    const [taquari, petropolis, jaboatao] = repository.stations();

    expect(taquari.status).toBe('ATENÇÃO');
    expect(petropolis.status).toBe('ATENÇÃO');
    expect(jaboatao.status).toBe('NORMAL');

    for (const station of repository.stations()) {
      expect(station.riskScore).toBeGreaterThanOrEqual(0);
      expect(station.riskScore).toBeLessThanOrEqual(100);
      expect(Object.values(station.shapValues).reduce((a, b) => a + b, 0)).toBe(100);
    }
  });

  it('leva a estação a ALERTA MÁXIMO na tempestade extrema', () => {
    repository.simulateExtremeStorm('EST-PE-33-JABOATAO');
    const station = repository.findStation('EST-PE-33-JABOATAO');

    expect(station?.status).toBe('ALERTA MÁXIMO');
    expect(station?.riskScore).toBe(100);
    expect(station?.trend).toBe('RISING');
  });

  it('devolve a estação às condições de referência', () => {
    repository.simulateExtremeStorm('EST-RS-62-MUCUM');
    repository.resetStation('EST-RS-62-MUCUM');

    const station = repository.findStation('EST-RS-62-MUCUM');
    expect(station?.status).toBe('ATENÇÃO');
    expect(station?.readings.rainfall24h).toBe(34);
  });

  it('congela as leituras da estação sem enlace', () => {
    repository.setStationOnline('EST-RJ-38-PETROPOLIS', false);
    const before = repository.findStation('EST-RJ-38-PETROPOLIS')?.readings;

    repository.startStream(1);
    expect(repository.isStreaming()).toBe(true);

    expect(repository.findStation('EST-RJ-38-PETROPOLIS')?.readings).toEqual(before);
  });

  it('numera protocolos em sequência dentro do ano', () => {
    expect(repository.nextProtocolSequence()).toBe(1);

    repository.saveDispatch({
      id: 'a',
      protocol: `SGI-${new Date().getFullYear()}-000001`,
      stationId: 'EST-PE-33-JABOATAO',
      stationName: 'Estação Jardim Monte Verde (Jaboatão)',
      basinCode: '33',
      status: 'ALERTA',
      riskScore: 72,
      shapValues: {
        accumulatedRainfall5d: 30,
        rainfall24h: 25,
        riverLevel: 20,
        soilSaturation: 15,
        slopeDisplacement: 10,
      },
      message: 'teste',
      channels: [],
      populationNotified: 0,
      operator: 'Plantão',
      triggeredBy: 'MANUAL',
      createdAt: new Date().toISOString(),
      completedAt: null,
      responseTimeMs: null,
      syncState: 'SYNCED',
    });

    expect(repository.nextProtocolSequence()).toBe(2);
    expect(repository.dispatches().length).toBe(1);

    repository.updateDispatch('a', { responseTimeMs: 1200, protocol: 'HACK' });
    expect(repository.dispatches()[0].responseTimeMs).toBe(1200);
    expect(repository.dispatches()[0].protocol).toBe(`SGI-${new Date().getFullYear()}-000001`);

    repository.clearAuditLog();
    expect(repository.dispatches()).toEqual([]);
  });
});
