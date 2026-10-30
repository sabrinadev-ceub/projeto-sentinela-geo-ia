# Arquitetura

## Visão geral

Angular 22, standalone e zoneless, sem backend e sem biblioteca de estado. O
estado vive em Signals dentro de serviços e repositórios; a persistência é
LocalStorage, o que sustenta o comportamento PWA offline-first.

A biblioteca de componentes é o Angular Material 22, tematizado sobre os
nossos design tokens. Tailwind está fora do projeto por decisão de stack: o
estilo de componente é SCSS sobre os tokens.

## Layout de pastas

```
public/                       Assets estáticos
  favicon.svg                 Marca do radar, segue o esquema de cores
  favicon.ico                 Fallback com arte própria em 16/32/48
docs/                         Esta documentação
src/
  index.html                  Shell + bootstrap de tema + fontes
  main.ts
  styles.scss                 Entrada global, agrega os parciais
  styles/
    _tokens.scss              Design tokens (cores, escala, easing, tipografia)
    _material.scss            Tema M3 do Material amarrado aos tokens
    _reset.scss
    _typography.scss
    _animations.scss          fade-in-up, scale-in, risk-pulse
    _patterns.scss            page-header, panel, section-label, risk-tone, risk-chip
  app/
    app.ts                    Shell: router-outlet + host de modais
    app.config.ts             Providers da aplicação
    app.routes.ts
    core/                     Regra de negócio, sem dependência de UI
      constants/
        emergency-channels.ts Política de canais e metadados de difusão
        risk-thresholds.ts    Limiares físicos, pesos e faixas do modelo
        storage-keys.ts
      domain/
        models/               Entidades puras (*.model.ts) + barrel
        repositories/         Contratos abstratos (DIP)
        use-cases/            Casos de uso isolados
      data/
        data.providers.ts     Amarração contrato → implementação
        repositories/         Implementações concretas
      services/
        storage.service.ts    LocalStorage com cache e relato de falha
    shared/                   Reutilizável, conhece apenas os modelos
      directives/
        fade-in-up.directive.ts
      ui/
        index.ts              Barrel de UI
        modal/                Sistema de modal nativo
    presentation/             Camada de apresentação (MVC + Facade)
      controllers/
        command-center.facade.ts   Controller da Central de Comando
      models/                 View models e estado exposto pelo Facade
      views/
        formatters.ts         Formatação pt-BR pura (número, duração, hora)
        pages/                Componentes smart: um por tela
        components/           Componentes dumb: só input/output
```

## Anéis

**`core`** é o anel interno: não importa nada de `features`, `layout` ou
`shared/ui`. Dentro dele, a Clean Architecture se divide em dois sub-anéis:

- `core/domain` não conhece implementação alguma. Modelos são tipos puros; os
  contratos são `abstract class` e os casos de uso dependem só desses
  contratos.
- `core/data` implementa os contratos. É o único lugar que sabe que a fonte de
  dados hoje é um mock em memória com LocalStorage.

**`shared`** oferece UI e diretivas reutilizáveis. Conhece os modelos de
domínio, nunca os repositórios nem os casos de uso.

**`presentation`** compõe casos de uso de `core` com componentes de `shared`.
Ocupa o lugar que o padrão de referência chama de `features`.

### MVC, Facade e Smart/Dumb

- **Controller / Facade**: `CommandCenterFacade` é o único ponto da tela que
  injeta `TelemetryRepository`, os casos de uso e o `ModalService`. Expõe
  estado apenas como `Signal`/`computed` somente leitura (estações, estação
  ativa, predição com drivers SHAP, histórico de disparos, sincronização PWA e
  KPIs da Meta 2.2.4) e recebe as intenções do operador por métodos de ação:
  `selectStation`, `simulateExtremeStorm`, `triggerManualAlert`,
  `resetSimulation`.
- **Página (smart)**: `CommandCenterPage` injeta só o Facade, repassa o estado
  por `input` e transforma `output` em chamada de ação.
- **Componentes (dumb)**: `OnPush`, `input.required()`/`output()`, sem
  serviço de negócio injetado. Cada um projeta os dados crus em view models
  com `computed()` e decide apenas a apresentação (SRP); um KPI ou uma
  grandeza física nova entra como mais um item de view model, sem tocar no
  template (OCP).

A modal de tempestade extrema recebe por `MODAL_DATA` um `Signal` do disparo,
não um valor: ela abre no instante do registro e mostra cada canal mudando de
`PENDING` para `DELIVERED` com a latência medida.

O painel SHAP mostra uma barra por variável do modelo (cinco, somando 100%).
As leituras dos sensores agrupam as cinco em quatro réguas: chuva 5 dias
(com a de 24h como leitura complementar), nível do rio contra a cota de
transbordo, saturação do solo e inclinômetro. A cota de transbordo é o limiar
máximo da régua da estação.

### Hierarquia da Central de Comando

Os blocos seguem a ordem de leitura do plantão, do mais urgente ao menos
urgente:

1. `network-status-bar`: nível mais grave da rede, onde ele está e a conduta
   do protocolo. Responde "alguma área está em risco agora?".
2. `station-map`, `station-selector` e `watch-log`: onde está o risco. O mapa
   plota cada estação na coordenada real; a lista dá nome, código e
   tendência; o diário registra cada mudança de nível e cada disparo.
3. `xai-shap-panel`: estação em foco, com a probabilidade de risco em
   destaque, a evolução recente, o porquê (SHAP) e o disparo manual.
4. `station-monitor-grid`: leituras brutas que sustentam a predição, cada uma
   com o gráfico de evolução contra os limiares.
5. `alert-audit-table`: o que já foi disparado.
6. `kpi-summary-bar`: indicadores de longo prazo da Meta 2.2.4, por último
   para não disputar atenção com o risco imediato.

A linguagem visual é minimalista: fundo preto, texto branco, cor pastel
reservada a status e ao destaque principal, sem gradientes, sombras ou
ícones decorativos. Branco sólido marca a única ação primária da tela.
Horários, coordenadas, códigos de estação e protocolos usam IBM Plex Mono,
como num instrumento; o resto do texto usa Inter.

### Histórico do streaming

O repositório guarda só o estado atual de cada estação. A evolução que os
gráficos e o diário mostram é acumulada no Facade por um `linkedSignal`, que
recebe as estações a cada ciclo e acrescenta a leitura nova ao valor
anterior: `HISTORY_SIZE` leituras por estação (3 minutos a 4 s por ciclo).
Reiniciar a simulação descarta esse histórico.

O diário só aceita uma mudança de nível quando o novo status se mantém por
`STATUS_CONFIRMATION_SAMPLES` leituras seguidas. Perto de um limiar o risco
oscila, e sem essa histerese o diário se encheria de idas e vindas entre
NORMAL e ATENÇÃO. A escalada para ALERTA ou acima é a exceção e entra na hora.

`trend-chart` é o gráfico compartilhado pelo painel de risco e pelas
leituras. Os pontos entram pela direita, ocupando só a fração do eixo já
coletada, para que três leituras não sejam esticadas pela largura inteira e
sugiram uma tendência que ainda não existe.

O contorno do mapa vem do Natural Earth 1:50m (domínio público), via
`world-atlas`, simplificado e embutido como constante em
`station-map/brazil-outline.ts`; o pacote não é dependência do projeto.

### Por que a Clean Architecture mora dentro de `core`

O padrão de referência do projeto tem quatro anéis no topo (`core`,
`features`, `shared`, `layout`). Promover `domain/` e `data/` para
`src/app/domain` e `src/app/data` criaria dois anéis novos no mesmo nível, e a
regra "`core` não importa de fora" perderia o seu alvo. Mantendo os dois
dentro de `core`, a regra continua valendo palavra por palavra e a separação
entidade / contrato / caso de uso / implementação fica explícita um nível
abaixo.

Equivalência com a nomenclatura canônica de Clean Architecture:

| Camada canônica  | Caminho no projeto          |
| ---------------- | --------------------------- |
| Entities         | `core/domain/models`        |
| Repository ports | `core/domain/repositories`  |
| Use cases        | `core/domain/use-cases`     |
| Infrastructure   | `core/data/repositories`    |
| Presentation     | `presentation`, `shared/ui` |

## Inversão de dependência

`TelemetryRepository` é uma `abstract class`, não uma `interface`: existe em
runtime e serve de token de injeção.

```ts
// core/domain/use-cases/trigger-emergency.use-case.ts
private readonly repository = inject(TelemetryRepository);
```

```ts
// core/data/data.providers.ts
{ provide: TelemetryRepository, useExisting: MockTelemetryRepository }
```

`data.providers.ts` é o único arquivo do app que nomeia a implementação
concreta. Trocar o mock por um cliente HTTP é mudar essa linha.

O contrato expõe estado como `Signal<T>`, o que acopla o domínio aos
primitivos de reatividade do Angular. É uma troca consciente: o ganho é a
camada de apresentação derivar tudo com `computed()` sem assinar nem cancelar
inscrição, e os `Signal` do Angular não arrastam dependência de DOM.

## Estado e reatividade

Cada serviço ou repositório mantém um `signal` privado e expõe `asReadonly()`
ou `computed()`. A persistência acontece em `effect()`, nunca espalhada pelos
métodos de escrita:

```ts
effect(() => {
  this.storage.set(STORAGE_KEYS.STATIONS, this._stations());
});
```

## Determinismo

O cálculo de risco e a difusão de alerta não usam `Math.random()`:

- `CalculateRiskXaiUseCase` é função pura de `readings` + `thresholds`.
- O jitter de latência dos canais vem de um hash FNV-1a do protocolo.
- A deriva das leituras no streaming usa um gerador congruencial linear
  semeado pelo id da estação.

A consequência prática é que um incidente se reproduz em desenvolvimento e um
disparo auditado se reconstrói em teste.

## Modelo de risco

Quatro etapas, documentadas em
`core/domain/use-cases/calculate-risk-xai.use-case.ts`:

1. **Normalização**: cada leitura vira severidade de 0 a 1 por interpolação
   linear entre os limiares da estação (0 → `attention` = 0 a 0,4;
   `attention` → `alert` = 0,4 a 0,7; `alert` → `maximum` = 0,7 a 1).
2. **Ponderação**: soma pelas importâncias base, que somam 1.
3. **Interação**: ganho superaditivo para solo saturado + chuva intensa
   (enxurrada) e acumulado de 5 dias + encosta em movimento (deslizamento).
4. **Escalada de protocolo**: variável acima do limiar máximo eleva o status
   independentemente da pontuação.

Os pesos SHAP são a contribuição relativa de cada variável, convertida em
percentual inteiro por maiores restos para que a soma feche exatamente 100.

## Angular Material

`src/styles/_material.scss` faz duas coisas, nesta ordem:

1. `mat.theme()` emite o conjunto completo de variáveis `--mat-sys-*`, com
   Inter como família `plain` e `brand`.
2. `mat.theme-overrides()` repinta cada papel de cor, raio e elevação do
   Material para os nossos tokens (`--color-*`, `--radius-*`, `--shadow-*`).

A ordem importa: sem o passo 2, o app teria dois sistemas de cor concorrentes:
a paleta M3 gerada do `$cyan-palette` e os nossos tokens. Com ele, os
tokens são a única fonte de verdade e o Material vira consumidor.

A troca claro/escuro não precisa de código: `mat.theme()` usa
`theme-type: color-scheme`, e o `color-scheme` que `data-theme` já controla em
`_reset.scss`/`_tokens.scss` arrasta os componentes do Material junto.

Material 22 não depende de `@angular/animations`, então não há
`provideAnimations()` em `app.config.ts`. `shared/ui/material.setup.spec.ts`
guarda essa premissa: monta botão, ícone e tooltip e resolve o `MatSnackBar`,
e falha se uma atualização reintroduzir a dependência.

## Sistema de modal

`shared/ui/modal` usa `<dialog>` nativo com `showModal()`: top layer,
backdrop, focus trap e ESC vêm do navegador.

### Por que não `MatDialog`

Com o Material disponível, `MatDialog` passou a ser uma opção, e foi
descartada por três motivos concretos:

- **Granularidade.** `MatDialog.open()` exige um componente por diálogo. Um
  alerta de severidade, uma confirmação e um aviso viram três componentes com
  três templates, onde aqui são três chamadas de função sobre um objeto de
  config.
- **Reatividade.** O ciclo do `MatDialog` é `afterClosed(): Observable`. O
  requisito do projeto é pilha em Signals, e `ModalService.stack` é um
  `Signal` que a UI consome com `computed()`, incluindo o estado `closing`,
  que não tem equivalente no `MatDialogRef`.
- **Animação.** O modal crítico tem halo pulsante, entrada em cascata dos
  detalhes e saída coordenada com `MODAL_EXIT_DURATION_MS`. Sobre `MatDialog`
  isso significaria sobrescrever a animação interna do componente.

O que o Material entrega de graça aqui (top layer, backdrop, focus trap, ESC)
o `<dialog>` nativo também entrega, sem o CDK Overlay no meio.

Isso vale para o modal, não para o resto: tabela, formulário, menu, tooltip,
snackbar e datepicker da etapa 2 vêm do Material.

- `modal.model.ts`: tipos, tokens `MODAL_DATA`/`MODAL_REF` e a duração de
  saída compartilhada com o SCSS.
- `modal.service.ts`: pilha em Signals, `open`/`confirm`/`alert`/`emergency`.
- `modal.component.ts`: host único montado em `app.ts`, renderiza a pilha.

Todo fechamento passa por `ModalService.close()`, que marca `closing` e só
remove o registro depois de `MODAL_EXIT_DURATION_MS`. Com isso ESC, backdrop,
botão de ação e fechamento programático animam igual.

## Build e deploy

O alvo é um artefato estático. Nenhum anel do projeto depende de servidor,
runtime de SSR ou variável de ambiente: a fronteira externa do sistema é o
`localStorage`, acessado só por `StorageService`. É o que permite publicar
em CDN e é o mesmo motivo pelo qual a operação offline-first funciona.

O `@angular/build:application` emite dois diretórios irmãos sob
`dist/<projeto>/`: `browser/` com o bundle do navegador e `server/` quando há
SSR. Aqui só o primeiro existe, e é ele a raiz publicável — o nível acima
carrega apenas `3rdpartylicenses.txt`.

Como o roteamento é do Angular, o host precisa devolver `index.html` para
qualquer caminho não encontrado no sistema de arquivos. É a única exigência
de infraestrutura do projeto, e está em `vercel.json`. Parâmetros em
[`README.md`](../README.md).

## Convenções

- Serviços terminam em `Service`; repositórios em `Repository`; casos de uso
  em `UseCase`, um por arquivo `*.use-case.ts`.
- Modelos são substantivos no singular em arquivos `*.model.ts`:
  `StationTelemetry`, `AlertDispatch`, `RiskAssessment`.
- Diretivas usam prefixo `app` em camelCase: `appFadeInUp`.
- Identificadores em inglês; texto de UI, comentários e documentação em
  português. A exceção é `RiskStatus`, cujos valores (`'ATENÇÃO'`,
  `'ALERTA MÁXIMO'`) são a nomenclatura operacional da Defesa Civil.
- Sem NgModules. Componentes standalone, `OnPush`, control flow nativo
  (`@if`, `@for`).
- Componentes do Material são importados por módulo próprio e direto no
  `imports` do componente que os usa (`MatTableModule`, `MatTooltipModule`),
  nunca agregados em um módulo compartilhado, e é isso que mantém o tree-shaking.
- Estilo de componente do Material se ajusta por `--mat-*` no escopo do
  componente, nunca por `::ng-deep`.
- O favicon é um radar de anel único, e não o glyph `radar` do Material: a
  16px os três anéis concêntricos do original colapsam em um borrão. Cada
  tamanho do `.ico` é rasterizado no tamanho final, nunca reamostrado de um
  master maior, que é o que mantém a aba nítida.
- Comentário explica decisão, nunca mecânica. Arquivos `.html`, `.scss` e
  `.spec.ts` não levam comentário.
