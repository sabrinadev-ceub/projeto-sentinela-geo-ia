# Sentinela GeoIA

Plataforma de monitoramento geo-hidrológico em tempo real com Inteligência
Artificial Explicável (XAI/SHAP) e disparo de alerta antecipado à Defesa Civil.

O projeto é alinhado à **Meta 2.2.4 do Plano Nacional de Proteção e Defesa
Civil (PN-PDC 2025-2035)**: ampliar a cobertura de monitoramento e alerta
antecipado em bacias hidrográficas de risco. As estações iniciais reproduzem
três bacias da Divisão Hidrográfica Nacional com histórico de desastre —
Taquari-Antas (62/RS), Litorânea do Rio de Janeiro (38/RJ) e Litorânea de
Pernambuco (33/PE).

Roda inteiramente no navegador: sem cadastro, sem servidor e sem dado saindo
do dispositivo. Tudo é persistido no `localStorage`, o que sustenta a operação
offline-first esperada de um PWA usado em área de desastre.

## O que já existe

**Etapa 1 — domínio, dados e sistema de modal.**

- **Telemetria de 5 sensores IoT por estação**: pluviometria 24h, chuva
  acumulada em 5 dias (gatilho de deslizamento do INPE), nível do rio,
  saturação do solo e inclinômetro de encosta.
- **Predição de risco de 0 a 100%** determinística, por interpolação entre os
  limiares físicos de cada estação, com ganho superaditivo para as combinações
  que a hidrologia trata como deflagradoras.
- **Explicabilidade (XAI/SHAP)**: peso percentual de cada variável na
  predição, somando exatamente 100, mais a lista ordenada de drivers com
  valor, unidade, severidade e limiares.
- **Escalada de protocolo**: variável acima do limiar máximo eleva o status
  independentemente da pontuação média.
- **Quatro níveis operacionais**: `NORMAL`, `ATENÇÃO`, `ALERTA` e
  `ALERTA MÁXIMO`.
- **Streaming contínuo simulado** com deriva fisicamente acoplada (a chuva
  alimenta o acumulado, o acumulado satura o solo, o solo eleva o rio e
  movimenta a encosta) e método de **tempestade extrema** por estação.
- **Histórico auditável de alertas** com protocolo sequencial, difusão por
  Push PWA, SMS, WhatsApp e Sirenes, tempo de resposta por canal, população
  notificada e fila offline.
- **Sistema de modal nativo** controlado por Signals: variantes de severidade,
  conteúdo dinâmico, ficha técnica de dados, botões customizáveis, fechamento
  por ESC e backdrop, e animações em cascata.

Dashboard, mapa e telas de operação entram na etapa 2.

## Como rodar o projeto?

Requer Node.js 20+ e npm 10+.

```bash
npm ci
npm start
```

Abre em `http://localhost:4200/`.

```bash
npm run build   # build de produção em dist/
npm test        # Vitest
```

## Estrutura do Projeto

```
src/app/
  core/          Regra de negócio, sem dependência de UI
    constants/   Limiares, pesos, política de canais, chaves de storage
    domain/      Entidades, contratos abstratos e casos de uso
    data/        Implementações dos contratos
    services/    Infraestrutura (LocalStorage)
  shared/        Diretivas e UI reutilizável
  layout/        Shell de navegação
  features/      Uma pasta por tela
src/styles/      Tokens e parciais SCSS globais
```

Detalhes em [`docs/arquitetura.md`](docs/arquitetura.md).

## Como Utilizar

### Consumir telemetria

Injete o **contrato**, nunca a implementação:

```ts
import { inject } from '@angular/core';
import { TelemetryRepository } from './core/domain/repositories/telemetry.repository';
import { CalculateRiskXaiUseCase } from './core/domain/use-cases/calculate-risk-xai.use-case';

private readonly repository = inject(TelemetryRepository);
private readonly calculateRisk = inject(CalculateRiskXaiUseCase);

readonly stations = this.repository.stations;
readonly critical = computed(() =>
  this.stations().filter((s) => s.status === 'ALERTA MÁXIMO'),
);

ngOnInit(): void {
  this.repository.startStream();
}
```

### Disparar emergência

```ts
import { TriggerEmergencyUseCase } from './core/domain/use-cases/trigger-emergency.use-case';

private readonly triggerEmergency = inject(TriggerEmergencyUseCase);

async dispatch(station: StationTelemetry): Promise<void> {
  const assessment = this.calculateRisk.execute(station);
  if (!this.triggerEmergency.canTrigger(assessment.status)) return;

  await this.triggerEmergency.execute({
    station,
    assessment,
    operator: 'Plantão Defesa Civil',
    triggeredBy: 'MANUAL',
  });
}
```

O registro de auditoria é persistido antes de qualquer espera: se a aba fechar
no meio da difusão, o protocolo já está gravado com os canais em `PENDING`.
Sem rede, os canais entram em `QUEUED_OFFLINE` e o registro fica
`PENDING_SYNC`.

### Abrir um modal

```ts
import { ModalService } from './shared/ui/modal/modal.service';

private readonly modal = inject(ModalService);

async confirmEvacuation(station: StationTelemetry): Promise<void> {
  const approved = await this.modal.emergency({
    title: 'Acionar evacuação imediata',
    overline: `Bacia ${station.basin.code} · ${station.name}`,
    message: 'A difusão alcança sirenes, Push, WhatsApp e SMS. A ação é irreversível.',
    details: [
      { label: 'Risco previsto', value: `${station.riskScore}%`, emphasis: true },
      { label: 'População exposta', value: station.exposedPopulation.toLocaleString('pt-BR') },
    ],
  });

  if (approved) await this.dispatch(station);
}
```

A API tem quatro entradas: `open` (controle total, devolve `ModalRef`),
`confirm` (resolve `boolean`), `alert` (reconhecimento) e `emergency`
(`confirm` crítico e não dispensável).

Para conteúdo dinâmico, passe um componente em `content` e leia os dados por
`inject(MODAL_DATA)`; `inject(MODAL_REF)` permite que o próprio conteúdo se
feche.

## Simular um desastre

```ts
repository.simulateExtremeStorm('EST-RS-62-MUCUM'); // leva a ALERTA MÁXIMO
repository.resetStation('EST-RS-62-MUCUM'); // volta à referência
repository.setStationOnline('EST-RJ-38-PETROPOLIS', false); // derruba o enlace
```

## Aviso

Este é um projeto acadêmico de demonstração. A telemetria é simulada e o
modelo de risco é uma aproximação determinística dos limiares publicados por
INPE e CEMADEN — não substitui sistema oficial de alerta. Em emergência real,
acione a Defesa Civil no **199** ou os Bombeiros no **193**.

## Licença

MIT.
