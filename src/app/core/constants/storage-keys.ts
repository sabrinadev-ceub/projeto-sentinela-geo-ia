/**
 * Chaves do LocalStorage. O prefixo isola o app de outros hosts no mesmo
 * domínio e versiona o schema sem precisar migrar dados antigos à força.
 */
export const STORAGE_KEYS = {
  STATIONS: 'sentinela:v1:stations',
  DISPATCHES: 'sentinela:v1:dispatches',
  LAST_SYNC: 'sentinela:v1:last-sync',
  THEME: 'sentinela:v1:theme',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];
