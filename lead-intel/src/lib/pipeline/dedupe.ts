/**
 * Deduplication and change tracking.
 *
 * The rule is: never append blindly. A company seen again is the same lead with
 * a new `last_seen_at`, a recorded field diff and a score history — not a second
 * row in the sheet.
 *
 * Company match order: normalised domain → provider company id → normalised
 * name + country. Contact match order: verified email → provider person id →
 * full name + company domain.
 */

import type { Contact, DiscoveredCompany, Lead } from '../types.js';
import { nameCountryKey, nameDomainKey } from '../store/json-store.js';
import type { CompanyMatchKeys, ContactMatchKeys } from '../store/types.js';
import { normaliseCompanyName, normaliseDomain, normaliseEmail } from '../util.js';

export function companyMatchKeys(company: DiscoveredCompany): CompanyMatchKeys {
  const domain = company.domain ?? normaliseDomain(company.website);
  return {
    domain,
    provider_company_id: company.provider_company_id,
    name_country_key: nameCountryKey(company.name, company.country),
  };
}

export function contactMatchKeys(input: {
  email: string | null;
  provider_person_id: string | null;
  full_name: string;
  domain: string | null;
}): ContactMatchKeys {
  return {
    email: normaliseEmail(input.email),
    provider_person_id: input.provider_person_id,
    name_domain_key: nameDomainKey(input.full_name, input.domain),
  };
}

/** Collapses duplicates inside a single discovery batch before any DB work. */
export function dedupeBatch(companies: DiscoveredCompany[]): {
  unique: DiscoveredCompany[];
  removed: number;
} {
  const byDomain = new Map<string, DiscoveredCompany>();
  const byProvider = new Map<string, DiscoveredCompany>();
  const byName = new Map<string, DiscoveredCompany>();
  const unique: DiscoveredCompany[] = [];
  let removed = 0;

  for (const company of companies) {
    const domain = company.domain ?? normaliseDomain(company.website);
    const providerKey = company.provider_company_id;
    const nameKey = nameCountryKey(company.name, company.country);

    const existing =
      (domain ? byDomain.get(domain) : undefined) ??
      (providerKey ? byProvider.get(providerKey) : undefined) ??
      byName.get(nameKey);

    if (existing) {
      mergeInto(existing, company);
      removed += 1;
      continue;
    }

    const record: DiscoveredCompany = { ...company, domain };
    unique.push(record);
    if (domain) byDomain.set(domain, record);
    if (providerKey) byProvider.set(providerKey, record);
    byName.set(nameKey, record);
  }

  return { unique, removed };
}

/** Fills gaps in the record we're keeping from the duplicate we're dropping. */
function mergeInto(target: DiscoveredCompany, extra: DiscoveredCompany): void {
  target.website ??= extra.website;
  target.domain ??= extra.domain;
  target.phone ??= extra.phone;
  target.address ??= extra.address;
  target.city ??= extra.city;
  target.country ??= extra.country;
  target.source_url ??= extra.source_url;
  target.provider_company_id ??= extra.provider_company_id;
  target.raw = { ...extra.raw, ...target.raw };
}

/** Fields worth telling a salesperson about when they change between runs. */
const TRACKED_FIELDS: (keyof Lead)[] = [
  'company_name',
  'website',
  'domain',
  'country',
  'city',
  'phone',
  'vertical',
  'icp_segment',
  'manufacturing_model',
  'fit_score',
  'confidence',
  'priority_segment',
  'qualification_status',
  'segment_key',
  'employee_range',
];

export function diffLead(previous: Lead, next: Lead): string[] {
  const changed: string[] = [];
  for (const field of TRACKED_FIELDS) {
    const before = previous[field];
    const after = next[field];
    if (JSON.stringify(before ?? null) !== JSON.stringify(after ?? null)) {
      changed.push(String(field));
    }
  }
  return changed;
}

const TRACKED_CONTACT_FIELDS: (keyof Contact)[] = [
  'full_name',
  'job_title',
  'persona_type',
  'email',
  'email_status',
  'phone',
  'profile_url',
];

export function diffContact(previous: Contact, next: Contact): string[] {
  const changed: string[] = [];
  for (const field of TRACKED_CONTACT_FIELDS) {
    if (JSON.stringify(previous[field] ?? null) !== JSON.stringify(next[field] ?? null)) {
      changed.push(String(field));
    }
  }
  return changed;
}

export { nameCountryKey, nameDomainKey, normaliseCompanyName };
