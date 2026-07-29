/**
 * Contact resolution for a qualified company.
 *
 * Runs only after a company passes scoring, because both providers charge per
 * lookup and there is no point buying the org chart of a company we won't call.
 * Apollo is the primary people source; Hunter fills email gaps and verifies.
 */

import { hunterDomainSearch, hunterVerify, isHunterConfigured } from '../sources/hunter.js';
import {
  enrichApolloPerson,
  isApolloConfigured,
  searchApolloPeople,
  type ApolloPerson,
} from '../sources/apollo.js';
import { classifyPersona, scoreContact, selectCommittee } from '../icp/personas.js';
import type { Contact, EmailStatus, PersonaType, SourceName } from '../types.js';
import { makeRef, newId, normaliseEmail, nowIso } from '../util.js';
import { nameDomainKey } from '../store/json-store.js';

export interface ResolvedContact {
  full_name: string;
  job_title: string | null;
  persona_type: PersonaType;
  email: string | null;
  email_status: EmailStatus;
  phone: string | null;
  profile_url: string | null;
  seniority: string | null;
  contact_score: number;
  source: SourceName;
  provider_person_id: string | null;
}

export interface ResolveContactsParams {
  domain: string | null;
  targetRoles: string[];
  limit: number;
  /** Verify addresses through Hunter. Costs a credit each. */
  verifyEmails: boolean;
}

export async function resolveContacts(
  params: ResolveContactsParams,
): Promise<ResolvedContact[]> {
  const { domain } = params;
  if (!domain) return [];

  const candidates = new Map<string, ResolvedContact>();

  if (isApolloConfigured()) {
    const people = await searchApolloPeople(domain, params.targetRoles, params.limit);
    for (const person of people) {
      const record = fromApollo(person);
      candidates.set(keyFor(record), record);
    }
  }

  if (isHunterConfigured()) {
    const hunterContacts = await hunterDomainSearch(domain, Math.max(params.limit * 2, 10));
    for (const hc of hunterContacts) {
      const key = keyFor({ full_name: hc.full_name, email: hc.email });
      const existing = candidates.get(key);
      if (existing) {
        // Apollo knows the person; Hunter knows the address. Merge, don't duplicate.
        existing.email ??= hc.email;
        if (existing.email === hc.email) existing.email_status = hc.email_status;
        existing.job_title ??= hc.job_title;
        existing.profile_url ??= hc.profile_url;
        existing.phone ??= hc.phone;
        continue;
      }
      candidates.set(key, {
        full_name: hc.full_name,
        job_title: hc.job_title,
        persona_type: hc.persona_type,
        email: hc.email,
        email_status: hc.email_status,
        phone: hc.phone,
        profile_url: hc.profile_url,
        seniority: hc.seniority,
        contact_score: 0,
        source: 'hunter',
        provider_person_id: null,
      });
    }
  }

  // Drop anyone whose title puts them outside the buying committee entirely.
  const relevant = [...candidates.values()].filter(
    (c) => c.persona_type !== 'unknown' || c.job_title === null,
  );

  for (const contact of relevant) {
    contact.persona_type = contact.persona_type === 'unknown'
      ? classifyPersona(contact.job_title)
      : contact.persona_type;
    contact.contact_score = scoreContact(contact);
  }

  const committee = selectCommittee(relevant, params.limit);

  // Reveal and verify only the contacts that actually made the cut.
  for (const contact of committee) {
    if (!contact.email && contact.provider_person_id && isApolloConfigured()) {
      const revealed = await enrichApolloPerson({
        provider_person_id: contact.provider_person_id,
        full_name: contact.full_name,
        job_title: contact.job_title,
        persona_type: contact.persona_type,
        email: contact.email,
        email_status: contact.email_status,
        phone: contact.phone,
        profile_url: contact.profile_url,
        seniority: contact.seniority,
      });
      contact.email = revealed.email;
      contact.email_status = revealed.email_status;
      contact.phone ??= revealed.phone;
    }

    if (params.verifyEmails && contact.email && contact.email_status !== 'verified') {
      contact.email_status = await hunterVerify(contact.email);
    }

    contact.contact_score = scoreContact(contact);
  }

  return committee.filter((c) => c.email_status !== 'invalid');
}

function fromApollo(person: ApolloPerson): ResolvedContact {
  return {
    full_name: person.full_name,
    job_title: person.job_title,
    persona_type: person.persona_type,
    email: person.email,
    email_status: person.email_status,
    phone: person.phone,
    profile_url: person.profile_url,
    seniority: person.seniority,
    contact_score: 0,
    source: 'apollo',
    provider_person_id: person.provider_person_id,
  };
}

function keyFor(record: { full_name: string; email: string | null }): string {
  const email = normaliseEmail(record.email);
  return email ?? record.full_name.trim().toLowerCase();
}

export function toContactRecord(
  resolved: ResolvedContact,
  leadId: string,
  domain: string | null,
): Contact {
  const now = nowIso();
  return {
    id: newId(),
    contact_ref: makeRef('FAB-C'),
    lead_id: leadId,
    full_name: resolved.full_name,
    job_title: resolved.job_title,
    persona_type: resolved.persona_type,
    email: normaliseEmail(resolved.email),
    email_status: resolved.email_status,
    phone: resolved.phone,
    profile_url: resolved.profile_url,
    seniority: resolved.seniority,
    contact_score: resolved.contact_score,
    source: resolved.source,
    provider_person_id: resolved.provider_person_id,
    name_domain_key: nameDomainKey(resolved.full_name, domain),
    first_seen_at: now,
    last_seen_at: now,
  };
}
