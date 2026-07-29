/** Store factory. Picks the adapter from config and caches one per process. */

import { config, resolveStoreDriver } from '../config.js';
import { log } from '../logger.js';
import { JsonLeadStore, nameCountryKey, nameDomainKey } from './json-store.js';
import { SupabaseLeadStore } from './supabase-store.js';
import type { LeadStore } from './types.js';

export type { LeadStore, LeadQuery, CompanyMatchKeys, ContactMatchKeys } from './types.js';
export { JsonLeadStore, SupabaseLeadStore, nameCountryKey, nameDomainKey };

let cached: LeadStore | null = null;

export async function getStore(): Promise<LeadStore> {
  if (cached) return cached;

  const driver = resolveStoreDriver();
  if (driver === 'supabase') {
    log.debug('Using Supabase store');
    const store = SupabaseLeadStore.fromConfig();
    await store.init();
    cached = store;
    return store;
  }

  log.debug(`Using JSON store at ${config.storage.jsonPath}`);
  const store = new JsonLeadStore(config.storage.jsonPath);
  await store.init();
  cached = store;
  return store;
}

/** Test/CLI escape hatch for pointing at an explicit JSON file. */
export async function getJsonStore(path: string): Promise<LeadStore> {
  const store = new JsonLeadStore(path);
  await store.init();
  return store;
}

export function resetStoreCache(): void {
  cached = null;
}
