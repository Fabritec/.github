/** Small shared helpers: domain normalisation, ids, fetch with timeout, pooling. */

import { randomUUID } from 'node:crypto';
import { config } from './config.js';

const STRIP_PREFIXES = ['www.', 'm.', 'en.'];

/**
 * Normalised domain is the primary dedupe key, so this has to be strict and
 * stable: lower-cased, no scheme, no www, no port, no path.
 */
export function normaliseDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let value = input.trim().toLowerCase();
  if (value.length === 0) return null;

  if (!value.includes('://')) value = `https://${value}`;

  let host: string;
  try {
    host = new URL(value).hostname;
  } catch {
    return null;
  }

  for (const prefix of STRIP_PREFIXES) {
    if (host.startsWith(prefix)) host = host.slice(prefix.length);
  }

  host = host.replace(/\.$/, '');
  if (!host.includes('.')) return null;
  return host;
}

export function normaliseUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  const value = input.trim();
  if (!value) return null;
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    return url.toString();
  } catch {
    return null;
  }
}

/** Company-name key for the fallback dedupe rule (name + country). */
export function normaliseCompanyName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(
      /\b(co|company|companies|llc|l\.l\.c|ltd|limited|inc|incorporated|corp|corporation|est|establishment|group|holdings?|industries|industrial|factory|factories|works|wll|w\.l\.l|sae|s\.a\.e|plc|gmbh|bv|nv|sarl|fze|fzc|fzco|dmcc|trading)\b/g,
      ' ',
    )
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normaliseEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const value = email.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) ? value : null;
}

export function newId(): string {
  return randomUUID();
}

let refCounter = 0;

/** Human-facing reference, e.g. FAB-L-20260729-0007. Unique per process run. */
export function makeRef(prefix: string): string {
  refCounter += 1;
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `${prefix}-${date}-${String(refCounter).padStart(4, '0')}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export interface FetchOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
  method?: string;
  body?: string;
}

export async function fetchWithTimeout(url: string, options: FetchOptions = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? config.pipeline.requestTimeoutMs,
  );
  try {
    return await fetch(url, {
      method: options.method ?? 'GET',
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
      redirect: 'follow',
    });
  } finally {
    clearTimeout(timeout);
  }
}

/** Bounded-concurrency map that preserves input order in the output. */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const size = Math.max(1, Math.min(concurrency, items.length || 1));

  async function runner(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!, index);
    }
  }

  await Promise.all(Array.from({ length: size }, runner));
  return results;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retries transient failures (network, 429, 5xx) with exponential backoff. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  baseDelayMs = 500,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) await sleep(baseDelayMs * 2 ** i);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
