/**
 * File-backed store. Not a database — no concurrent writers, no transactions —
 * but it makes the whole pipeline runnable and testable without Supabase, and
 * it is the store the demo seed and the test suite use.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Contact, Evidence, Lead, Run } from '../types.js';
import { normaliseCompanyName } from '../util.js';
import { applyLeadQuery } from './query.js';
import type { CompanyMatchKeys, ContactMatchKeys, LeadQuery, LeadStore } from './types.js';

interface Snapshot {
  version: 1;
  leads: Lead[];
  contacts: Contact[];
  evidence: Evidence[];
  runs: Run[];
}

function empty(): Snapshot {
  return { version: 1, leads: [], contacts: [], evidence: [], runs: [] };
}

export class JsonLeadStore implements LeadStore {
  private data: Snapshot = empty();
  private loaded = false;
  private dirty = false;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  async init(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await readFile(resolve(this.path), 'utf8');
      const parsed = JSON.parse(raw) as Partial<Snapshot>;
      this.data = {
        version: 1,
        leads: parsed.leads ?? [],
        contacts: parsed.contacts ?? [],
        evidence: parsed.evidence ?? [],
        runs: parsed.runs ?? [],
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      this.data = empty();
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    const target = resolve(this.path);
    const snapshot = JSON.stringify(this.data, null, 2);

    // Serialise writes and go through a temp file so a crash can't truncate the store.
    this.writeChain = this.writeChain.then(async () => {
      await mkdir(dirname(target), { recursive: true });
      const tmp = `${target}.${process.pid}.tmp`;
      await writeFile(tmp, snapshot, 'utf8');
      await rename(tmp, target);
    });
    await this.writeChain;
  }

  async flush(): Promise<void> {
    await this.persist();
    await this.writeChain;
  }

  async findLead(keys: CompanyMatchKeys): Promise<Lead | null> {
    await this.init();
    if (keys.domain) {
      const hit = this.data.leads.find((l) => l.domain === keys.domain);
      if (hit) return hit;
    }
    if (keys.provider_company_id) {
      const hit = this.data.leads.find(
        (l) => l.provider_company_id === keys.provider_company_id,
      );
      if (hit) return hit;
    }
    if (keys.name_country_key) {
      const hit = this.data.leads.find(
        (l) => nameCountryKey(l.company_name, l.country) === keys.name_country_key,
      );
      if (hit) return hit;
    }
    return null;
  }

  async upsertLead(lead: Lead): Promise<Lead> {
    await this.init();
    const index = this.data.leads.findIndex((l) => l.id === lead.id);
    if (index >= 0) this.data.leads[index] = lead;
    else this.data.leads.push(lead);
    this.dirty = true;
    await this.persist();
    return lead;
  }

  async getLead(id: string): Promise<Lead | null> {
    await this.init();
    return this.data.leads.find((l) => l.id === id) ?? null;
  }

  async listLeads(query: LeadQuery = {}): Promise<Lead[]> {
    await this.init();
    return applyLeadQuery(this.data.leads, query);
  }

  async countLeads(query: LeadQuery = {}): Promise<number> {
    await this.init();
    return applyLeadQuery(this.data.leads, { ...query, limit: undefined, offset: undefined })
      .length;
  }

  async updateLeadFields(
    id: string,
    fields: Partial<Pick<Lead, 'crm_status' | 'assigned_to' | 'notes' | 'qualification_status'>>,
  ): Promise<Lead | null> {
    await this.init();
    const lead = this.data.leads.find((l) => l.id === id);
    if (!lead) return null;
    Object.assign(lead, fields);
    this.dirty = true;
    await this.persist();
    return lead;
  }

  async findContact(keys: ContactMatchKeys): Promise<Contact | null> {
    await this.init();
    if (keys.email) {
      const hit = this.data.contacts.find((c) => c.email === keys.email);
      if (hit) return hit;
    }
    if (keys.provider_person_id) {
      const hit = this.data.contacts.find(
        (c) => c.provider_person_id === keys.provider_person_id,
      );
      if (hit) return hit;
    }
    if (keys.name_domain_key) {
      const hit = this.data.contacts.find((c) => c.name_domain_key === keys.name_domain_key);
      if (hit) return hit;
    }
    return null;
  }

  async upsertContact(contact: Contact): Promise<Contact> {
    await this.init();
    const index = this.data.contacts.findIndex((c) => c.id === contact.id);
    if (index >= 0) this.data.contacts[index] = contact;
    else this.data.contacts.push(contact);
    this.dirty = true;
    await this.persist();
    return contact;
  }

  async listContacts(leadIds?: string[]): Promise<Contact[]> {
    await this.init();
    if (!leadIds) return [...this.data.contacts];
    const set = new Set(leadIds);
    return this.data.contacts.filter((c) => set.has(c.lead_id));
  }

  async addEvidence(items: Evidence[]): Promise<void> {
    if (items.length === 0) return;
    await this.init();
    this.data.evidence.push(...items);
    this.dirty = true;
    await this.persist();
  }

  async listEvidence(leadIds?: string[]): Promise<Evidence[]> {
    await this.init();
    if (!leadIds) return [...this.data.evidence];
    const set = new Set(leadIds);
    return this.data.evidence.filter((e) => set.has(e.lead_id));
  }

  async createRun(run: Run): Promise<Run> {
    await this.init();
    this.data.runs.push(run);
    this.dirty = true;
    await this.persist();
    return run;
  }

  async updateRun(id: string, patch: Partial<Run>): Promise<Run | null> {
    await this.init();
    const run = this.data.runs.find((r) => r.id === id);
    if (!run) return null;
    Object.assign(run, patch);
    this.dirty = true;
    await this.persist();
    return run;
  }

  async getRun(id: string): Promise<Run | null> {
    await this.init();
    return this.data.runs.find((r) => r.id === id) ?? null;
  }

  async listRuns(limit = 50): Promise<Run[]> {
    await this.init();
    return [...this.data.runs]
      .sort((a, b) => b.started_at.localeCompare(a.started_at))
      .slice(0, limit);
  }
}

export function nameCountryKey(name: string, country: string | null): string {
  return `${normaliseCompanyName(name)}::${(country ?? '').trim().toLowerCase()}`;
}

export function nameDomainKey(name: string, domain: string | null): string | null {
  if (!domain) return null;
  return `${normaliseCompanyName(name)}::${domain}`;
}
