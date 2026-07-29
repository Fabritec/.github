/**
 * Supabase adapter — the intended source of truth in production.
 *
 * Uses the service-role key, so this module must only ever be imported from
 * server-side code (API routes, scripts, cron). Never from a client component.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import type { Contact, Evidence, Lead, Run } from '../types.js';
import { nameCountryKey, nameDomainKey } from './json-store.js';
import { applyLeadQuery } from './query.js';
import type { CompanyMatchKeys, ContactMatchKeys, LeadQuery, LeadStore } from './types.js';

const LEADS = 'leads';
const CONTACTS = 'contacts';
const EVIDENCE = 'evidence';
const RUNS = 'runs';

export class SupabaseLeadStore implements LeadStore {
  private client: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  static fromConfig(): SupabaseLeadStore {
    if (!config.supabase.url || !config.supabase.serviceRoleKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set');
    }
    return new SupabaseLeadStore(config.supabase.url, config.supabase.serviceRoleKey);
  }

  async init(): Promise<void> {
    // Schema is managed by supabase/migrations; a cheap probe surfaces a missing
    // migration as a clear error instead of a confusing one on first insert.
    const { error } = await this.client.from(LEADS).select('id').limit(1);
    if (error) {
      throw new Error(
        `Supabase not ready (${error.message}). Run the SQL in supabase/migrations/ first.`,
      );
    }
  }

  async flush(): Promise<void> {
    // Writes are synchronous against the API; nothing buffered.
  }

  async findLead(keys: CompanyMatchKeys): Promise<Lead | null> {
    if (keys.domain) {
      const hit = await this.first({ column: 'domain', value: keys.domain });
      if (hit) return hit;
    }
    if (keys.provider_company_id) {
      const hit = await this.first({
        column: 'provider_company_id',
        value: keys.provider_company_id,
      });
      if (hit) return hit;
    }
    if (keys.name_country_key) {
      const hit = await this.first({ column: 'name_country_key', value: keys.name_country_key });
      if (hit) return hit;
    }
    return null;
  }

  private async first(match: { column: string; value: string }): Promise<Lead | null> {
    const { data, error } = await this.client
      .from(LEADS)
      .select('*')
      .eq(match.column, match.value)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`Supabase findLead failed: ${error.message}`);
    return data ? rowToLead(data) : null;
  }

  async upsertLead(lead: Lead): Promise<Lead> {
    const { data, error } = await this.client
      .from(LEADS)
      .upsert(leadToRow(lead), { onConflict: 'id' })
      .select()
      .single();
    if (error) throw new Error(`Supabase upsertLead failed: ${error.message}`);
    return rowToLead(data);
  }

  async getLead(id: string): Promise<Lead | null> {
    const { data, error } = await this.client
      .from(LEADS)
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`Supabase getLead failed: ${error.message}`);
    return data ? rowToLead(data) : null;
  }

  async listLeads(query: LeadQuery = {}): Promise<Lead[]> {
    let builder = this.client.from(LEADS).select('*');

    // Push the cheap, highly selective filters down to Postgres; the rest is
    // applied in memory so both adapters behave identically.
    if (query.statuses?.length) builder = builder.in('qualification_status', query.statuses);
    if (query.segments?.length) builder = builder.in('priority_segment', query.segments);
    if (query.runId) builder = builder.eq('latest_run_id', query.runId);
    if (typeof query.minScore === 'number') builder = builder.gte('fit_score', query.minScore);
    if (query.firstSeenSince) builder = builder.gte('first_seen_at', query.firstSeenSince);

    const { data, error } = await builder
      .order('fit_score', { ascending: false, nullsFirst: false })
      .limit(query.limit ? query.limit + (query.offset ?? 0) : 5000);
    if (error) throw new Error(`Supabase listLeads failed: ${error.message}`);

    return applyLeadQuery((data ?? []).map(rowToLead), {
      countries: query.countries,
      verticals: query.verticals,
      search: query.search,
      limit: query.limit,
      offset: query.offset,
    });
  }

  async countLeads(query: LeadQuery = {}): Promise<number> {
    let builder = this.client.from(LEADS).select('id', { count: 'exact', head: true });
    if (query.statuses?.length) builder = builder.in('qualification_status', query.statuses);
    if (query.segments?.length) builder = builder.in('priority_segment', query.segments);
    if (query.runId) builder = builder.eq('latest_run_id', query.runId);
    if (query.firstSeenSince) builder = builder.gte('first_seen_at', query.firstSeenSince);
    const { count, error } = await builder;
    if (error) throw new Error(`Supabase countLeads failed: ${error.message}`);
    return count ?? 0;
  }

  async updateLeadFields(
    id: string,
    fields: Partial<Pick<Lead, 'crm_status' | 'assigned_to' | 'notes' | 'qualification_status'>>,
  ): Promise<Lead | null> {
    const { data, error } = await this.client
      .from(LEADS)
      .update(fields)
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) throw new Error(`Supabase updateLeadFields failed: ${error.message}`);
    return data ? rowToLead(data) : null;
  }

  async findContact(keys: ContactMatchKeys): Promise<Contact | null> {
    const tries: { column: string; value: string }[] = [];
    if (keys.email) tries.push({ column: 'email', value: keys.email });
    if (keys.provider_person_id) {
      tries.push({ column: 'provider_person_id', value: keys.provider_person_id });
    }
    if (keys.name_domain_key) {
      tries.push({ column: 'name_domain_key', value: keys.name_domain_key });
    }

    for (const t of tries) {
      const { data, error } = await this.client
        .from(CONTACTS)
        .select('*')
        .eq(t.column, t.value)
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`Supabase findContact failed: ${error.message}`);
      if (data) return rowToContact(data);
    }
    return null;
  }

  async upsertContact(contact: Contact): Promise<Contact> {
    const { data, error } = await this.client
      .from(CONTACTS)
      .upsert(contactToRow(contact), { onConflict: 'id' })
      .select()
      .single();
    if (error) throw new Error(`Supabase upsertContact failed: ${error.message}`);
    return rowToContact(data);
  }

  async listContacts(leadIds?: string[]): Promise<Contact[]> {
    let builder = this.client.from(CONTACTS).select('*');
    if (leadIds) builder = builder.in('lead_id', leadIds);
    const { data, error } = await builder.order('contact_score', { ascending: false });
    if (error) throw new Error(`Supabase listContacts failed: ${error.message}`);
    return (data ?? []).map(rowToContact);
  }

  async addEvidence(items: Evidence[]): Promise<void> {
    if (items.length === 0) return;
    const { error } = await this.client.from(EVIDENCE).insert(items);
    if (error) throw new Error(`Supabase addEvidence failed: ${error.message}`);
  }

  async listEvidence(leadIds?: string[]): Promise<Evidence[]> {
    let builder = this.client.from(EVIDENCE).select('*');
    if (leadIds) builder = builder.in('lead_id', leadIds);
    const { data, error } = await builder.order('collected_at', { ascending: false });
    if (error) throw new Error(`Supabase listEvidence failed: ${error.message}`);
    return (data ?? []) as Evidence[];
  }

  async createRun(run: Run): Promise<Run> {
    const { data, error } = await this.client.from(RUNS).insert(run).select().single();
    if (error) throw new Error(`Supabase createRun failed: ${error.message}`);
    return data as Run;
  }

  async updateRun(id: string, patch: Partial<Run>): Promise<Run | null> {
    const { data, error } = await this.client
      .from(RUNS)
      .update(patch)
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) throw new Error(`Supabase updateRun failed: ${error.message}`);
    return (data as Run) ?? null;
  }

  async getRun(id: string): Promise<Run | null> {
    const { data, error } = await this.client.from(RUNS).select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`Supabase getRun failed: ${error.message}`);
    return (data as Run) ?? null;
  }

  async listRuns(limit = 50): Promise<Run[]> {
    const { data, error } = await this.client
      .from(RUNS)
      .select('*')
      .order('started_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`Supabase listRuns failed: ${error.message}`);
    return (data ?? []) as Run[];
  }
}

/** Generated columns kept in the row so Postgres can index the dedupe keys. */
function leadToRow(lead: Lead): Record<string, unknown> {
  return {
    ...lead,
    name_country_key: nameCountryKey(lead.company_name, lead.country),
  };
}

function rowToLead(row: Record<string, unknown>): Lead {
  const { name_country_key: _ignored, ...rest } = row;
  return rest as unknown as Lead;
}

function contactToRow(contact: Contact): Record<string, unknown> {
  return { ...contact };
}

function rowToContact(row: Record<string, unknown>): Contact {
  return row as unknown as Contact;
}

export { nameDomainKey };
