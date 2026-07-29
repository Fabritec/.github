/**
 * CSV/manual import for the sources that have no API: SteelFab and Big 5
 * exhibitor directories, contractor registries, AISC/ISO certified-fabricator
 * lists, association member lists, and whatever the team collected at an event.
 *
 * These lists are usually the best leads in the run — a company that paid for a
 * stand at SteelFab is a company that is investing — so they get the same
 * enrichment and scoring path as API-discovered companies, no shortcuts.
 */

import { readFile } from 'node:fs/promises';
import type { DiscoveredCompany, SourceName } from '../types.js';
import { normaliseDomain, normaliseUrl } from '../util.js';

/** RFC4180-ish parser: handles quoted fields, embedded commas and newlines. */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const text = input.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

const HEADER_ALIASES: Record<string, string[]> = {
  name: ['name', 'company', 'company name', 'companyname', 'exhibitor', 'organisation', 'organization'],
  website: ['website', 'web', 'url', 'site', 'domain', 'web site'],
  phone: ['phone', 'telephone', 'tel', 'mobile', 'contact number'],
  address: ['address', 'street', 'location'],
  city: ['city', 'town', 'emirate'],
  country: ['country'],
  note: ['note', 'notes', 'stand', 'booth', 'hall', 'category', 'sector'],
};

function mapHeaders(header: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  header.forEach((raw, index) => {
    const key = raw.trim().toLowerCase();
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (map[field] === undefined && aliases.includes(key)) map[field] = index;
    }
  });
  return map;
}

export interface ImportOptions {
  /** Which source label these rows should carry through the pipeline. */
  source?: SourceName;
  /** Fallback country when the file has no country column. */
  defaultCountry?: string | null;
  /** Where the list came from, recorded as the lead's source URL. */
  sourceUrl?: string | null;
}

export function parseCompanyList(
  csvText: string,
  options: ImportOptions = {},
): DiscoveredCompany[] {
  const rows = parseCsv(csvText);
  if (rows.length < 2) return [];

  const map = mapHeaders(rows[0]!);
  if (map.name === undefined) {
    throw new Error(
      `Import needs a company-name column. Found: ${rows[0]!.join(', ') || '(empty header)'}`,
    );
  }

  const source = options.source ?? 'manual_import';
  const out: DiscoveredCompany[] = [];

  for (const row of rows.slice(1)) {
    const cell = (field: string): string | null => {
      const index = map[field];
      if (index === undefined) return null;
      const value = row[index]?.trim();
      return value && value.length > 0 ? value : null;
    };

    const name = cell('name');
    if (!name) continue;

    const website = normaliseUrl(cell('website'));
    out.push({
      name,
      website,
      domain: normaliseDomain(website),
      phone: cell('phone'),
      address: cell('address'),
      city: cell('city'),
      country: cell('country') ?? options.defaultCountry ?? null,
      source,
      source_url: options.sourceUrl ?? null,
      provider_company_id: null,
      raw: { note: cell('note') },
    });
  }

  return out;
}

export async function loadCompanyListFile(
  path: string,
  options: ImportOptions = {},
): Promise<DiscoveredCompany[]> {
  const text = await readFile(path, 'utf8');
  return parseCompanyList(text, options);
}
