/** Campaign criteria construction, shared by the CLI and the API route. */

import type { CampaignCriteria, SourceName, Vertical } from './types.js';
import { DEFAULT_CITIES, DEFAULT_QUERIES } from './sources/google-places.js';
import { DEFAULT_TARGET_ROLES } from './icp/personas.js';

export const DEFAULT_EXCLUSIONS = [
  'trading',
  'distributor',
  'wholesale',
  'importer',
  'stockist',
  'consultancy',
  'recruitment',
];

export function buildCriteria(partial: Partial<CampaignCriteria> = {}): CampaignCriteria {
  return {
    campaign_name: partial.campaign_name ?? 'Untitled campaign',
    countries: partial.countries ?? [],
    cities: partial.cities ?? DEFAULT_CITIES,
    queries: partial.queries ?? DEFAULT_QUERIES,
    verticals: partial.verticals ?? [],
    employees_min: partial.employees_min ?? 20,
    employees_max: partial.employees_max ?? 250,
    target_roles: partial.target_roles ?? DEFAULT_TARGET_ROLES,
    exclude: partial.exclude ?? DEFAULT_EXCLUSIONS,
    target_accounts: partial.target_accounts ?? 200,
    sources: partial.sources ?? ['google_places', 'apollo'],
    dry_run: partial.dry_run ?? false,
    contacts_per_company: partial.contacts_per_company ?? 3,
  };
}

const VALID_VERTICALS: Vertical[] = [
  'steel',
  'aluminium',
  'precast',
  'peb',
  'modular',
  'joinery',
  'job_shop',
  'other',
];

const VALID_SOURCES: SourceName[] = [
  'google_places',
  'apollo',
  'hunter',
  'website',
  'directory_import',
  'exhibitor_import',
  'manual_import',
  'fixture',
];

export function parseVerticals(input: string[]): Vertical[] {
  return input
    .map((v) => v.trim().toLowerCase() as Vertical)
    .filter((v) => VALID_VERTICALS.includes(v));
}

export function parseSources(input: string[]): SourceName[] {
  return input
    .map((s) => s.trim().toLowerCase() as SourceName)
    .filter((s) => VALID_SOURCES.includes(s));
}

/** A ready-made campaign matching the example in the product brief. */
export const EXAMPLE_CAMPAIGNS: Record<string, Partial<CampaignCriteria>> = {
  'ksa-heavy-fabrication': {
    campaign_name: 'Saudi Arabia — steel, PEB and heavy fabrication',
    countries: ['Saudi Arabia'],
    cities: ['Riyadh, Saudi Arabia', 'Dammam, Saudi Arabia', 'Jubail, Saudi Arabia', 'Jeddah, Saudi Arabia'],
    queries: ['steel fabrication', 'PEB manufacturer', 'heavy fabrication', 'structural steel fabricator'],
    verticals: ['steel', 'peb', 'job_shop'],
    employees_min: 20,
    employees_max: 250,
    target_accounts: 200,
  },
  'egypt-fabricators': {
    campaign_name: 'Egypt — steel and aluminium fabrication',
    countries: ['Egypt'],
    cities: ['Cairo, Egypt', 'Alexandria, Egypt', '10th of Ramadan City, Egypt', 'Sadat City, Egypt'],
    queries: ['steel fabrication', 'aluminium fabrication', 'metal works factory', 'precast concrete factory'],
    verticals: ['steel', 'aluminium', 'precast'],
    employees_min: 20,
    employees_max: 250,
    target_accounts: 150,
  },
  'uae-qatar-fabricators': {
    campaign_name: 'UAE and Qatar — fabrication and PEB',
    countries: ['United Arab Emirates', 'Qatar'],
    cities: [
      'Sharjah, United Arab Emirates',
      'Dubai, United Arab Emirates',
      'Abu Dhabi, United Arab Emirates',
      'Doha, Qatar',
    ],
    queries: ['steel fabrication', 'aluminium fabrication', 'PEB manufacturer', 'precast concrete factory'],
    verticals: ['steel', 'aluminium', 'peb', 'precast'],
    employees_min: 20,
    employees_max: 250,
    target_accounts: 150,
  },
};
