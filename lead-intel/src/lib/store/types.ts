/**
 * Storage contract. Supabase is the intended source of truth; the JSON adapter
 * exists so the pipeline, the exporters and the tests can run with no database.
 */

import type { Contact, Evidence, Lead, Run } from '../types.js';

export interface LeadQuery {
  statuses?: Lead['qualification_status'][];
  countries?: string[];
  verticals?: NonNullable<Lead['vertical']>[];
  segments?: NonNullable<Lead['priority_segment']>[];
  runId?: string;
  minScore?: number;
  /** ISO timestamp; returns leads first seen at or after it. */
  firstSeenSince?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

/** The three company-matching rules, tried in order. */
export interface CompanyMatchKeys {
  domain: string | null;
  provider_company_id: string | null;
  name_country_key: string | null;
}

/** The three contact-matching rules, tried in order. */
export interface ContactMatchKeys {
  email: string | null;
  provider_person_id: string | null;
  name_domain_key: string | null;
}

export interface LeadStore {
  init(): Promise<void>;

  findLead(keys: CompanyMatchKeys): Promise<Lead | null>;
  upsertLead(lead: Lead): Promise<Lead>;
  getLead(id: string): Promise<Lead | null>;
  listLeads(query?: LeadQuery): Promise<Lead[]>;
  countLeads(query?: LeadQuery): Promise<number>;
  updateLeadFields(
    id: string,
    fields: Partial<Pick<Lead, 'crm_status' | 'assigned_to' | 'notes' | 'qualification_status'>>,
  ): Promise<Lead | null>;

  findContact(keys: ContactMatchKeys): Promise<Contact | null>;
  upsertContact(contact: Contact): Promise<Contact>;
  listContacts(leadIds?: string[]): Promise<Contact[]>;

  addEvidence(items: Evidence[]): Promise<void>;
  listEvidence(leadIds?: string[]): Promise<Evidence[]>;

  createRun(run: Run): Promise<Run>;
  updateRun(id: string, patch: Partial<Run>): Promise<Run | null>;
  getRun(id: string): Promise<Run | null>;
  listRuns(limit?: number): Promise<Run[]>;

  /** Flush any buffered writes. No-op for Supabase. */
  flush(): Promise<void>;
}
