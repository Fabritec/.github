/**
 * Segments are derived, never hand-maintained.
 *
 * The segment key is `vertical × country × capacity band × score tier`, which
 * means adding a country or a capacity band to a campaign automatically creates
 * the corresponding segments (and the corresponding sheet tabs) with no config.
 */

import type { CapacityBand, Lead, PrioritySegment, Vertical } from '../types.js';
import { capacityBandFor, capacityBandLabel, VERTICAL_FIT } from './rubric.js';

export interface SegmentParts {
  vertical: Vertical;
  country: string;
  capacity_band: CapacityBand;
  tier: PrioritySegment;
}

const VERTICAL_LABELS: Record<Vertical, string> = {
  steel: 'Steel Fabrication',
  aluminium: 'Aluminium Fabrication',
  precast: 'Precast',
  peb: 'PEB',
  modular: 'Modular',
  joinery: 'Joinery',
  job_shop: 'Job Shop',
  other: 'Other',
};

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'unknown';
}

export function buildSegmentKey(parts: SegmentParts): string {
  return [parts.vertical, slug(parts.country), parts.capacity_band, parts.tier].join('|');
}

export function segmentPartsFor(lead: {
  vertical: Vertical | null;
  country: string | null;
  facts: { estimated_capacity_tpm: number | null } | null;
  priority_segment: PrioritySegment | null;
}): SegmentParts {
  return {
    vertical: lead.vertical ?? 'other',
    country: lead.country ?? 'Unknown',
    capacity_band: capacityBandFor(lead.facts?.estimated_capacity_tpm ?? null),
    tier: lead.priority_segment ?? 'D',
  };
}

export function segmentLabel(parts: SegmentParts): string {
  return `${VERTICAL_LABELS[parts.vertical]} · ${prettifyCountry(parts.country)} · ${capacityBandLabel(
    parts.capacity_band,
  )} · Tier ${parts.tier}`;
}

export function parseSegmentKey(key: string): SegmentParts | null {
  const [vertical, country, capacity, tier] = key.split('|');
  if (!vertical || !country || !capacity || !tier) return null;
  return {
    vertical: vertical as Vertical,
    country,
    capacity_band: capacity as CapacityBand,
    tier: tier as PrioritySegment,
  };
}

export function icpSegmentName(vertical: Vertical | null): string {
  return VERTICAL_FIT[vertical ?? 'other'].segment;
}

export interface SegmentSummary {
  key: string;
  label: string;
  parts: SegmentParts;
  count: number;
  avg_score: number;
  leads: Lead[];
}

/** Groups leads into derived segments, biggest and highest-scoring first. */
export function groupIntoSegments(leads: Lead[]): SegmentSummary[] {
  const buckets = new Map<string, Lead[]>();

  for (const lead of leads) {
    const parts = segmentPartsFor(lead);
    const key = lead.segment_key ?? buildSegmentKey(parts);
    const existing = buckets.get(key);
    if (existing) existing.push(lead);
    else buckets.set(key, [lead]);
  }

  const summaries: SegmentSummary[] = [];
  for (const [key, bucketLeads] of buckets) {
    const parts = parseSegmentKey(key) ?? segmentPartsFor(bucketLeads[0]!);
    const scores = bucketLeads.map((l) => l.fit_score ?? 0);
    summaries.push({
      key,
      label: segmentLabel(parts),
      parts,
      count: bucketLeads.length,
      avg_score: scores.length
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : 0,
      leads: [...bucketLeads].sort((a, b) => (b.fit_score ?? 0) - (a.fit_score ?? 0)),
    });
  }

  return summaries.sort(
    (a, b) => b.avg_score - a.avg_score || b.count - a.count || a.key.localeCompare(b.key),
  );
}

/** Turns a slugged country back into something readable: `saudi-arabia` → `Saudi Arabia`. */
export function prettifyCountry(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((word) => (word.length <= 3 ? word.toUpperCase() : word[0]!.toUpperCase() + word.slice(1)))
    .join(' ');
}

/**
 * Sheet tab names are capped at 31 chars by Excel and must avoid `[]:*?/\`.
 *
 * The budget is spent on the country rather than the vertical, because
 * "A-Steel-Saudi Arabia" is findable and "A-Steel Fabrication-saudi-arabi" is
 * not. Collisions are resolved with a numeric suffix by the caller.
 */
export function segmentTabName(parts: SegmentParts): string {
  const vertical = VERTICAL_LABELS[parts.vertical].split(' ')[0]!;
  const country = prettifyCountry(parts.country);
  const prefix = `${parts.tier}-${vertical}-`;
  const room = 31 - prefix.length;
  const trimmed = country.length > room ? country.slice(0, Math.max(room, 0)).trimEnd() : country;
  return `${prefix}${trimmed}`.replace(/[[\]:*?/\\]/g, '-').slice(0, 31);
}
