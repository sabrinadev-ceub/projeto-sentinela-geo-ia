import { Injectable, signal } from '@angular/core';
import { StorageKey } from '../constants/storage-keys';

export type StorageFailureReason = 'quota' | 'unavailable' | 'unknown';

export interface StorageFailure {
  reason: StorageFailureReason;
  /** Sobe a cada falha nova: é o que distingue uma falha de outra já dispensada. */
  seq: number;
}

/**
 * Acesso ao LocalStorage com cache em memória e relato de falha.
 *
 * O cache evita reparsear JSON a cada leitura durante o streaming de sensores,
 * e mantém o app funcional quando a gravação falha por cota estourada. É a
 * base do suporte PWA offline-first.
 */
@Injectable({ providedIn: 'root' })
export class StorageService {
  readonly failure = signal<StorageFailure | null>(null);

  // Declarado antes de `storage`: `resolveStorage` já reporta falha.
  private readonly storage: Storage | null = this.resolveStorage();

  private readonly cache = new Map<StorageKey, unknown>();
  private readonly failed = new Map<StorageKey, unknown>();

  get<T>(key: StorageKey): T | null {
    if (this.cache.has(key)) return this.cache.get(key) as T;

    const value = this.readRaw(key);
    if (value === null) return null;

    this.cache.set(key, value);
    return value as T;
  }

  set<T>(key: StorageKey, value: T): void {
    this.cache.set(key, value);
    this.commit(key, value);
  }

  remove(key: StorageKey): void {
    this.cache.delete(key);
    this.failed.delete(key);
    this.storage?.removeItem(key);
  }

  clear(): void {
    this.cache.clear();
    this.failed.clear();
    this.storage?.clear();
  }

  /** Reaplica as gravações que falharam, do mais antigo para o mais recente. */
  retry(): void {
    if (!this.storage) return;

    const pending = [...this.failed];
    this.failed.clear();
    this.failure.set(null);

    for (const [key, value] of pending) this.commit(key, value);
  }

  private commit(key: StorageKey, value: unknown): void {
    if (!this.storage) return;

    try {
      this.storage.setItem(key, JSON.stringify(value));
      this.failed.delete(key);
      if (this.failed.size === 0 && this.failure()?.reason !== 'unavailable') {
        this.failure.set(null);
      }
    } catch (error) {
      this.failed.set(key, value);
      this.failure.update((current) => ({
        reason: isQuotaError(error) ? 'quota' : 'unknown',
        seq: (current?.seq ?? 0) + 1,
      }));
    }
  }

  private readRaw(key: StorageKey): unknown {
    if (!this.storage) return null;

    try {
      const raw = this.storage.getItem(key);
      return raw === null ? null : JSON.parse(raw);
    } catch {
      // JSON inválido: descarta em vez de derrubar o app.
      this.storage.removeItem(key);
      return null;
    }
  }

  private resolveStorage(): Storage | null {
    try {
      const probe = '__storage_probe__';
      window.localStorage.setItem(probe, probe);
      window.localStorage.removeItem(probe);
      return window.localStorage;
    } catch {
      this.failure.set({ reason: 'unavailable', seq: 1 });
      return null;
    }
  }
}

function isQuotaError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')
  );
}
