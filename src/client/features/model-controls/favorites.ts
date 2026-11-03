import { useSyncExternalStore } from 'react';
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client';

type ModelGroup = ModelDirectoryState['groups'][number];

export interface ModelEntry { readonly group: ModelGroup; readonly model: ModelGroup['models'][number]; }

const STORAGE = 'ccd-model-favorites';
/** Rows the main card holds; digits 1–4 reach them. */
export const FAVORITE_LIMIT = 4;

export const modelKey = (provider: string, model: string): string => `${provider}/${model}`;

/** Accept only a list of keys, so a damaged entry falls back to the catalog's own order. */
export function readFavorites(raw: string | null): readonly string[] | null {
  try {
    const value: unknown = JSON.parse(raw ?? 'null');
    return Array.isArray(value) && value.every(key => typeof key === 'string') ? value.slice(0, FAVORITE_LIMIT) : null;
  } catch { return null; }
}

/**
 * Split the catalog between the main card and the More models card.
 *
 * Saved keys keep the user's order and drop any route that left the catalog.
 * Nothing saved, or nothing saved still offered, leaves the first four models in
 * catalog order so the card never opens without a row.
 *
 * @param groups - the directory's provider groups.
 * @param saved - the stored keys, or null before the first pin.
 * @returns the main rows and the rest, in catalog order.
 */
export function splitModels(groups: readonly ModelGroup[], saved: readonly string[] | null): { primary: ModelEntry[]; rest: ModelEntry[] } {
  const entries = groups.flatMap(group => group.models.map(model => ({ group, model })));
  const byKey = new Map(entries.map(entry => [modelKey(entry.group.id, entry.model.id), entry]));
  const pinned = (saved ?? []).flatMap(key => byKey.get(key) ?? []);
  const primary = pinned.length > 0 ? pinned : entries.slice(0, FAVORITE_LIMIT);
  return { primary, rest: entries.filter(entry => !primary.includes(entry)) };
}

let favorites: readonly string[] | null | undefined;
const listeners = new Set<() => void>();

function snapshot(): readonly string[] | null {
  if (favorites === undefined) {
    try { favorites = readFavorites(localStorage.getItem(STORAGE)); } catch { favorites = null; }
  }
  return favorites;
}

/** Composers in one window share the list; read-only storage keeps it in memory. */
export function saveFavorites(next: readonly string[]): void {
  favorites = next;
  try { localStorage.setItem(STORAGE, JSON.stringify(next)); } catch { /* Retain the list in memory. */ }
  listeners.forEach(listener => listener());
}

export function useFavorites(): readonly string[] | null {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, snapshot, () => null);
}
