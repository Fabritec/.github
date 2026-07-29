/**
 * Apollo: company search for the account layer, people search for the contact
 * layer. Apollo's search endpoints return people without contact details; the
 * enrichment endpoint is what reveals email/phone, so the two are separate calls
 * and we only spend enrichment credits on companies that already passed scoring.
 */

import { config } from '../config.js';
import { log } from '../logger.js';
import type { DiscoveredCompany, EmailStatus, PersonaType } from '../types.js';
import { fetchWithTimeout, normaliseDomain, normaliseEmail, normaliseUrl, withRetry } from '../util.js';
import { classifyPersona } from '../icp/personas.js';

const BASE = 'https://api.apollo.io/api/v1';

export function isApolloConfigured(): boolean {
  return config.apollo.apiKey !== null;
}

async function apolloPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  return withRetry(async () => {
    const res = await fetchWithTimeout(`${BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        accept: 'application/json',
        'x-api-key': config.apollo.apiKey!,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Apollo ${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    return (await res.json()) as T;
  });
}

interface ApolloOrg {
  id?: string;
  name?: string;
  website_url?: string;
  primary_domain?: string;
  phone?: string;
  estimated_num_employees?: number;
  industry?: string;
  keywords?: string[];
  short_description?: string;
  country?: string;
  city?: string;
  raw_address?: string;
}

export interface ApolloCompanySearchParams {
  /** Free-text keywords, e.g. "steel fabrication". */
  keywords: string[];
  countries: string[];
  employeesMin: number | null;
  employeesMax: number | null;
  limit: number;
}

export async function searchApolloCompanies(
  params: ApolloCompanySearchParams,
): Promise<DiscoveredCompany[]> {
  if (!isApolloConfigured()) {
    log.warn('Apollo skipped: APOLLO_API_KEY not set');
    return [];
  }

  const out: DiscoveredCompany[] = [];
  const perPage = 25;
  const maxPages = Math.max(1, Math.ceil(params.limit / perPage));

  for (let page = 1; page <= maxPages && out.length < params.limit; page += 1) {
    try {
      const body: Record<string, unknown> = {
        page,
        per_page: perPage,
        q_organization_keyword_tags: params.keywords,
      };
      if (params.countries.length > 0) body.organization_locations = params.countries;
      if (params.employeesMin !== null || params.employeesMax !== null) {
        body.organization_num_employees_ranges = [
          `${params.employeesMin ?? 1},${params.employeesMax ?? 100000}`,
        ];
      }

      const data = await apolloPost<{ organizations?: ApolloOrg[]; accounts?: ApolloOrg[] }>(
        '/mixed_companies/search',
        body,
      );
      const orgs = [...(data.organizations ?? []), ...(data.accounts ?? [])];
      if (orgs.length === 0) break;

      for (const org of orgs) {
        out.push(toDiscovered(org));
        if (out.length >= params.limit) break;
      }
    } catch (err) {
      log.warn(`Apollo company page ${page} failed: ${err instanceof Error ? err.message : err}`);
      break;
    }
  }

  return out;
}

function toDiscovered(org: ApolloOrg): DiscoveredCompany {
  const website = normaliseUrl(org.website_url ?? org.primary_domain ?? null);
  return {
    name: org.name?.trim() ?? 'Unknown',
    website,
    domain: normaliseDomain(org.primary_domain ?? website),
    phone: org.phone ?? null,
    address: org.raw_address ?? null,
    city: org.city ?? null,
    country: org.country ?? null,
    source: 'apollo',
    source_url: org.id ? `https://app.apollo.io/#/organizations/${org.id}` : null,
    provider_company_id: org.id ?? null,
    raw: {
      industry: org.industry ?? null,
      keywords: org.keywords ?? [],
      short_description: org.short_description ?? null,
      estimated_num_employees: org.estimated_num_employees ?? null,
    },
  };
}

/** Flattens an Apollo org record into the text block handed to the model. */
export function apolloProviderSummary(raw: Record<string, unknown>): string | null {
  const parts: string[] = [];
  if (typeof raw.industry === 'string') parts.push(`Industry: ${raw.industry}`);
  if (typeof raw.estimated_num_employees === 'number') {
    parts.push(`Employees (provider estimate): ${raw.estimated_num_employees}`);
  }
  if (Array.isArray(raw.keywords) && raw.keywords.length > 0) {
    parts.push(`Keywords: ${raw.keywords.slice(0, 30).join(', ')}`);
  }
  if (typeof raw.short_description === 'string') {
    parts.push(`Description: ${raw.short_description}`);
  }
  return parts.length > 0 ? parts.join('\n') : null;
}

export interface ApolloPerson {
  provider_person_id: string | null;
  full_name: string;
  job_title: string | null;
  persona_type: PersonaType;
  email: string | null;
  email_status: EmailStatus;
  phone: string | null;
  profile_url: string | null;
  seniority: string | null;
}

interface ApolloPersonRecord {
  id?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  email?: string;
  email_status?: string;
  linkedin_url?: string;
  seniority?: string;
  phone_numbers?: { raw_number?: string; sanitized_number?: string }[];
}

/** People search by company domain and target titles. */
export async function searchApolloPeople(
  domain: string,
  titles: string[],
  limit: number,
): Promise<ApolloPerson[]> {
  if (!isApolloConfigured()) return [];

  try {
    const data = await apolloPost<{ people?: ApolloPersonRecord[] }>('/mixed_people/search', {
      q_organization_domains_list: [domain],
      person_titles: titles,
      page: 1,
      per_page: Math.min(Math.max(limit * 3, 10), 50),
    });
    return (data.people ?? []).map(toPerson);
  } catch (err) {
    log.warn(`Apollo people search failed for ${domain}: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

/**
 * Reveals contact details for a person already found by search. Kept separate
 * because it consumes credits — only call it for contacts you intend to keep.
 */
export async function enrichApolloPerson(person: ApolloPerson): Promise<ApolloPerson> {
  if (!isApolloConfigured() || !person.provider_person_id) return person;

  try {
    const data = await apolloPost<{ person?: ApolloPersonRecord }>('/people/match', {
      id: person.provider_person_id,
      reveal_personal_emails: false,
    });
    if (!data.person) return person;
    const enriched = toPerson(data.person);
    return {
      ...person,
      email: enriched.email ?? person.email,
      email_status: enriched.email ? enriched.email_status : person.email_status,
      phone: enriched.phone ?? person.phone,
      profile_url: enriched.profile_url ?? person.profile_url,
    };
  } catch (err) {
    log.debug(`Apollo person enrich failed: ${err instanceof Error ? err.message : err}`);
    return person;
  }
}

function toPerson(record: ApolloPersonRecord): ApolloPerson {
  const name =
    record.name?.trim() ||
    [record.first_name, record.last_name].filter(Boolean).join(' ').trim() ||
    'Unknown';
  const email = normaliseEmail(record.email);
  return {
    provider_person_id: record.id ?? null,
    full_name: name,
    job_title: record.title?.trim() ?? null,
    persona_type: classifyPersona(record.title ?? null),
    email,
    email_status: mapEmailStatus(record.email_status, email),
    phone: record.phone_numbers?.[0]?.sanitized_number ?? record.phone_numbers?.[0]?.raw_number ?? null,
    profile_url: record.linkedin_url ?? null,
    seniority: record.seniority ?? null,
  };
}

function mapEmailStatus(status: string | undefined, email: string | null): EmailStatus {
  if (!email) return 'unknown';
  switch (status) {
    case 'verified':
      return 'verified';
    case 'likely to engage':
    case 'guessed':
      return 'unverified';
    case 'unavailable':
      return 'unknown';
    default:
      return 'unverified';
  }
}
