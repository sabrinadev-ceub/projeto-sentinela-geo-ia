/**
 * Rota de evacuação do Plano de Contingência municipal, acionada junto com o
 * alerta. É ela que transforma o aviso em ação: o alerta diz *que* sair, a
 * rota diz *por onde* e *para onde*.
 */
export interface EvacuationRoute {
  /** Código da rota no Plano de Contingência (ex.: 'R-62-01'). */
  code: string;
  name: string;
  /** Ponto de apoio de destino. */
  shelter: string;
  shelterAddress: string;
  /** Cota do ponto de apoio em metros: precisa ficar fora da mancha de inundação. */
  shelterAltitude: number;
  /** Pessoas que o ponto de apoio comporta. */
  shelterCapacity: number;
  distanceKm: number;
  /** Tempo estimado de deslocamento a pé, em minutos. */
  walkingMinutes: number;
  /** Trechos na ordem de deslocamento. */
  waypoints: string[];
}
