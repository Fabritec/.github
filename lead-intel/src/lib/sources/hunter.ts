/**
 * Hunter: domain search to find business emails, and verification so we never
 * push an unverified address into the sheet as if it were deliverable.
 */

import { config } from '../config.js';
import { log } from '../logger.js';
import type { EmailStatus, PersonaType } from '../types.js';
import { fetchWithTimeout, normaliseEmail, withRetry } from '../util.js';
import { classifyPersona } from '../icp/personas.js';

const BASE = 'https://api.hunter.io/v2';

export function isHunterConfigured(): boolean {
  return config.hunter.apiKey !== null;
}

async function hunterGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('api_key', config.hunter.apiKey!);

  return withRetry(async () => {
    const res = await fetchWithTimeout(url.toString());
    if (!res.ok) {
      throw new Error(`Hunter ${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    return (await res.json()) as T;
  });
}

export interface HunterContact {
  full_name: string;
  job_title: string | null;
  persona_type: PersonaType;
  email: string;
  email_status: EmailStatus;
  phone: string | null;
  profile_url: string | null;
  seniority: string | null;
  confidence: number;
}

interface HunterEmailRecord {
  value?: string;
  type?: string;
  confidence?: number;
  first_name?: string;
  last_name?: string;
  position?: string;
  seniority?: string;
  linkedin?: string;
  phone_number?: string;
  verification?: { status?: string };
}

/** Personal (not role-based) emails on a domain, best confidence first. */
export async function hunterDomainSearch(domain: string, limit = 10): Promise<HunterContact[]> {
  if (!isHunterConfigured()) return [];

  try {
    const data = await hunterGet<{ data?: { emails?: HunterEmailRecord[] } }>('/domain-search', {
      domain,
      limit: String(Math.min(limit, 100)),
      type: 'personal',
    });

    const contacts: HunterContact[] = [];
    for (const record of data.data?.emails ?? []) {
      const email = normaliseEmail(record.value);
      if (!email) continue;
      const name = [record.first_name, record.last_name].filter(Boolean).join(' ').trim();
      contacts.push({
        full_name: name || email.split('@')[0]!,
        job_title: record.position?.trim() ?? null,
        persona_type: classifyPersona(record.position ?? null),
        email,
        email_status: mapVerification(record.verification?.status, record.confidence ?? null),
        phone: record.phone_number ?? null,
        profile_url: record.linkedin ?? null,
        seniority: record.seniority ?? null,
        confidence: record.confidence ?? 0,
      });
    }
    return contacts.sort((a, b) => b.confidence - a.confidence);
  } catch (err) {
    log.warn(`Hunter domain search failed for ${domain}: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

/** Verifies a single address. Returns 'unknown' rather than throwing on failure. */
export async function hunterVerify(email: string): Promise<EmailStatus> {
  if (!isHunterConfigured()) return 'unknown';
  try {
    const data = await hunterGet<{ data?: { status?: string; result?: string } }>(
      '/email-verifier',
      { email },
    );
    return mapVerification(data.data?.status ?? data.data?.result, null);
  } catch (err) {
    log.debug(`Hunter verify failed for ${email}: ${err instanceof Error ? err.message : err}`);
    return 'unknown';
  }
}

function mapVerification(status: string | undefined, confidence: number | null): EmailStatus {
  switch (status) {
    case 'valid':
    case 'deliverable':
      return 'verified';
    case 'accept_all':
    case 'webmail':
      return 'accept_all';
    case 'invalid':
    case 'undeliverable':
    case 'disposable':
      return 'invalid';
    case 'unknown':
    case 'risky':
      return 'unverified';
    default:
      if (confidence !== null && confidence >= 90) return 'accept_all';
      return 'unverified';
  }
}
