/**
 * The orchestrator.
 *
 *   discover → dedupe → hard rules → website read → AI facts → hard rules again
 *   → contacts → score → segment → persist (update, never duplicate)
 *
 * Every stage is best-effort at the item level: one company failing to enrich
 * doesn't fail the run, it lands in the review queue with the reason attached.
 */

import { config } from '../config.js';
import { log } from '../logger.js';
import { emptyFacts } from '../ai/schema.js';
import { enrichCompany } from '../ai/enrich.js';
import { postEnrichmentRules, preEnrichmentRules } from '../icp/hard-rules.js';
import { scoreCompany } from '../icp/score.js';
import { buildSegmentKey, icpSegmentName, segmentPartsFor } from '../icp/segments.js';
import { DEFAULT_TARGET_ROLES } from '../icp/personas.js';
import { capacityBandFor } from '../icp/rubric.js';
import {
  apolloProviderSummary,
  isApolloConfigured,
  searchApolloCompanies,
} from '../sources/apollo.js';
import { isGooglePlacesConfigured, searchPlaces } from '../sources/google-places.js';
import { readSite } from '../sources/website.js';
import { loadFixtureCompanies, fixtureFactsFor, fixturePagesFor } from '../sources/fixtures.js';
import type { LeadStore } from '../store/index.js';
import type {
  CampaignCriteria,
  CompanyFacts,
  Contact,
  DiscoveredCompany,
  Evidence,
  Lead,
  Run,
} from '../types.js';
import { makeRef, mapPool, newId, normaliseDomain, nowIso } from '../util.js';
import { companyMatchKeys, contactMatchKeys, dedupeBatch, diffLead } from './dedupe.js';
import { resolveContacts, toContactRecord, type ResolvedContact } from './contacts.js';

export interface RunCampaignOptions {
  criteria: CampaignCriteria;
  store: LeadStore;
  /**
   * Companies supplied by the caller — a CSV import of an exhibitor list, a
   * directory scrape, a re-run of a saved set. They are processed before API
   * discoveries and go through the identical enrichment and scoring path.
   */
  seedCompanies?: DiscoveredCompany[];
  /** Called after each company is processed, for CLI progress and the UI. */
  onProgress?: (done: number, total: number, company: string) => void;
}

export interface RunCampaignResult {
  run: Run;
  newLeads: Lead[];
  updatedLeads: Lead[];
}

export async function runCampaign(options: RunCampaignOptions): Promise<RunCampaignResult> {
  const { criteria, store } = options;
  const run: Run = {
    id: newId(),
    run_ref: makeRef('FAB-R'),
    campaign_name: criteria.campaign_name,
    criteria,
    started_at: nowIso(),
    finished_at: null,
    status: 'running',
    companies_found: 0,
    companies_qualified: 0,
    contacts_found: 0,
    duplicates_removed: 0,
    rejected: 0,
    sent_to_review: 0,
    export_filename: null,
    error: null,
  };
  await store.createRun(run);

  try {
    const discovered = [...(options.seedCompanies ?? []), ...(await discover(criteria))];
    const { unique, removed } = dedupeBatch(discovered);
    run.companies_found = unique.length;
    run.duplicates_removed = removed;
    log.info(
      `Discovered ${discovered.length} companies, ${unique.length} unique (${removed} duplicates collapsed)`,
    );

    const targets = unique.slice(0, criteria.target_accounts);
    const newLeads: Lead[] = [];
    const updatedLeads: Lead[] = [];
    let processed = 0;

    const outcomes = await mapPool(targets, config.pipeline.concurrency, async (company) => {
      const outcome = await processCompany(company, criteria, run.id, store);
      processed += 1;
      options.onProgress?.(processed, targets.length, company.name);
      return outcome;
    });

    for (const outcome of outcomes) {
      if (!outcome) continue;
      if (outcome.isNew) newLeads.push(outcome.lead);
      else updatedLeads.push(outcome.lead);

      run.contacts_found += outcome.contactCount;
      switch (outcome.lead.qualification_status) {
        case 'qualified':
          run.companies_qualified += 1;
          break;
        case 'rejected':
          run.rejected += 1;
          break;
        case 'review':
          run.sent_to_review += 1;
          break;
        default:
          break;
      }
    }

    run.status = 'completed';
    run.finished_at = nowIso();
    await store.updateRun(run.id, run);
    await store.flush();

    return { run, newLeads, updatedLeads };
  } catch (err) {
    run.status = 'failed';
    run.error = err instanceof Error ? err.message : String(err);
    run.finished_at = nowIso();
    await store.updateRun(run.id, run);
    await store.flush();
    throw err;
  }
}

async function discover(criteria: CampaignCriteria): Promise<DiscoveredCompany[]> {
  if (criteria.dry_run) {
    log.info('Dry run: using bundled fixtures instead of live discovery');
    return loadFixtureCompanies(criteria);
  }

  const found: DiscoveredCompany[] = [];

  if (criteria.sources.includes('google_places') && isGooglePlacesConfigured()) {
    const places = await searchPlaces({
      queries: criteria.queries,
      cities: criteria.cities,
      maxPerCell: Math.max(20, Math.ceil(criteria.target_accounts / 2)),
    });
    log.info(`Google Places returned ${places.length} companies`);
    found.push(...places);
  }

  if (criteria.sources.includes('apollo') && isApolloConfigured()) {
    const apollo = await searchApolloCompanies({
      keywords: criteria.queries,
      countries: criteria.countries,
      employeesMin: criteria.employees_min,
      employeesMax: criteria.employees_max,
      limit: criteria.target_accounts,
    });
    log.info(`Apollo returned ${apollo.length} companies`);
    found.push(...apollo);
  }

  if (found.length === 0) {
    log.warn(
      'No discovery source produced results. Check API keys, or run with --dry-run to use fixtures.',
    );
  }

  return found;
}

interface CompanyOutcome {
  lead: Lead;
  isNew: boolean;
  contactCount: number;
}

async function processCompany(
  company: DiscoveredCompany,
  criteria: CampaignCriteria,
  runId: string,
  store: LeadStore,
): Promise<CompanyOutcome | null> {
  const domain = company.domain ?? normaliseDomain(company.website);

  // Stage 1: cheap deterministic gate, before we spend any money on this company.
  const pre = preEnrichmentRules(company, criteria);
  if (!pre.passed) {
    log.debug(`Pre-rules rejected ${company.name}: ${pre.reasons.join('; ')}`);
    return persist({
      company,
      domain,
      facts: emptyFacts(`Rejected before enrichment: ${pre.reasons.join('; ')}`),
      contacts: [],
      score: null,
      rejectionReasons: pre.reasons,
      runId,
      store,
    });
  }

  // Stage 2: read the website.
  const pages = criteria.dry_run
    ? fixturePagesFor(company)
    : company.website
      ? await readSite(company.website)
      : [];

  // Stage 3: extract facts.
  const facts: CompanyFacts = criteria.dry_run
    ? fixtureFactsFor(company)
    : (
        await enrichCompany({
          companyName: company.name,
          website: company.website,
          country: company.country,
          city: company.city,
          address: company.address,
          phone: company.phone,
          sourceNote: `${company.source}${company.source_url ? ` (${company.source_url})` : ''}`,
          pages,
          providerSummary:
            company.source === 'apollo' ? apolloProviderSummary(company.raw) : null,
        })
      ).facts;

  // Stage 4: hard rules again, now against real facts.
  const post = postEnrichmentRules(facts, criteria);
  if (!post.passed) {
    log.debug(`Post-rules rejected ${company.name}: ${post.reasons.join('; ')}`);
    return persist({
      company,
      domain,
      facts,
      contacts: [],
      score: null,
      rejectionReasons: post.reasons,
      runId,
      store,
    });
  }

  // Stage 5: contacts, for companies we actually intend to call.
  const contacts = criteria.dry_run
    ? []
    : await resolveContacts({
        domain,
        targetRoles: criteria.target_roles.length > 0 ? criteria.target_roles : DEFAULT_TARGET_ROLES,
        limit: criteria.contacts_per_company,
        verifyEmails: true,
      });

  // Stage 6: score in code, from facts.
  const score = scoreCompany({
    facts,
    country: company.country,
    contacts: contacts.map((c) => ({
      persona_type: c.persona_type,
      email: c.email,
      email_status: c.email_status,
    })),
  });

  return persist({
    company,
    domain,
    facts,
    contacts,
    score,
    rejectionReasons: score.rejection_reasons,
    runId,
    store,
  });
}

interface PersistParams {
  company: DiscoveredCompany;
  domain: string | null;
  facts: CompanyFacts;
  contacts: ResolvedContact[];
  score: ReturnType<typeof scoreCompany> | null;
  rejectionReasons: string[];
  runId: string;
  store: LeadStore;
}

async function persist(params: PersistParams): Promise<CompanyOutcome> {
  const { company, domain, facts, score, store, runId } = params;
  const now = nowIso();

  const existing = await store.findLead(companyMatchKeys(company));

  const draft: Lead = {
    id: existing?.id ?? newId(),
    lead_ref: existing?.lead_ref ?? makeRef('FAB-L'),
    company_name: company.name,
    website: company.website ?? existing?.website ?? null,
    domain: domain ?? existing?.domain ?? null,
    country: company.country ?? existing?.country ?? null,
    city: company.city ?? existing?.city ?? null,
    address: company.address ?? existing?.address ?? null,
    phone: company.phone ?? existing?.phone ?? null,
    industry: typeof company.raw.industry === 'string' ? company.raw.industry : existing?.industry ?? null,
    vertical: facts.vertical,
    icp_segment: icpSegmentName(facts.vertical),
    segment_key: null,
    capacity_band: capacityBandFor(facts.estimated_capacity_tpm),
    employee_range: employeeRange(facts.employee_estimate) ?? existing?.employee_range ?? null,
    manufacturing_model: facts.manufacturing_model,
    fit_score: score?.fit_score ?? null,
    confidence: score?.confidence ?? null,
    priority_segment: score?.priority_segment ?? (params.rejectionReasons.length > 0 ? 'D' : null),
    qualification_status: score?.qualification_status ?? 'rejected',
    qualification_reason:
      score?.qualification_reason ??
      (params.rejectionReasons.length > 0
        ? `Rejected: ${params.rejectionReasons.join('; ')}`
        : null),
    pain_signals: facts.pain_signals,
    outreach_angle: facts.outreach_angle || null,
    rejection_reasons: params.rejectionReasons,
    detailing_software: facts.detailing_software,
    source: company.source,
    source_url: company.source_url ?? existing?.source_url ?? null,
    provider_company_id: company.provider_company_id ?? existing?.provider_company_id ?? null,
    first_seen_at: existing?.first_seen_at ?? now,
    last_seen_at: now,
    last_enriched_at: now,
    original_run_id: existing?.original_run_id ?? runId,
    latest_run_id: runId,
    previous_score: existing?.current_score ?? null,
    current_score: score?.fit_score ?? null,
    changed_fields: [],
    crm_status: existing?.crm_status ?? 'new',
    assigned_to: existing?.assigned_to ?? null,
    notes: existing?.notes ?? null,
    facts,
    score_breakdown: score ? [...score.breakdown, ...score.bonuses] : null,
  };

  draft.segment_key = buildSegmentKey(segmentPartsFor(draft));
  draft.changed_fields = existing ? diffLead(existing, draft) : [];

  const saved = await store.upsertLead(draft);

  const evidence: Evidence[] = facts.evidence.map((item) => ({
    id: newId(),
    lead_id: saved.id,
    evidence_type: item.claim,
    finding: item.finding,
    source_url: item.source_url,
    collected_at: now,
    ai_confidence: facts.confidence,
  }));
  await store.addEvidence(evidence);

  let contactCount = 0;
  for (const resolved of params.contacts) {
    const record = toContactRecord(resolved, saved.id, saved.domain);
    const match = await store.findContact(
      contactMatchKeys({
        email: record.email,
        provider_person_id: record.provider_person_id,
        full_name: record.full_name,
        domain: saved.domain,
      }),
    );

    const merged: Contact = match
      ? { ...match, ...record, id: match.id, contact_ref: match.contact_ref, first_seen_at: match.first_seen_at, last_seen_at: now }
      : record;

    await store.upsertContact(merged);
    contactCount += 1;
  }

  return { lead: saved, isNew: existing === null, contactCount };
}

function employeeRange(estimate: number | null): string | null {
  if (estimate === null) return null;
  if (estimate < 10) return '1-9';
  if (estimate < 20) return '10-19';
  if (estimate < 50) return '20-49';
  if (estimate < 100) return '50-99';
  if (estimate < 250) return '100-249';
  if (estimate < 500) return '250-499';
  if (estimate < 1000) return '500-999';
  return '1000+';
}
