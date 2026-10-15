import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { TelemetryRepository } from '../domain/repositories/telemetry.repository';
import { MockTelemetryRepository } from './repositories/mock-telemetry.repository';

/**
 * Amarra os contratos de domínio às implementações concretas.
 *
 * É o único ponto do app que conhece `MockTelemetryRepository`: trocar a fonte
 * de dados por um cliente HTTP real significa mudar uma linha aqui, sem tocar
 * em use case nem em feature (DIP).
 */
export function provideDataLayer(): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: TelemetryRepository, useExisting: MockTelemetryRepository },
  ]);
}
