/** Shared in-memory lead filtering, so both store adapters sort and page alike. */

import type { Lead } from '../types.js';
import type { LeadQuery } from './types.js';

export function applyLeadQuery(leads: Lead[], query: LeadQuery = {}): Lead[] {
  let out = [...leads];

  if (query.statuses?.length) {
    const set = new Set(query.statuses);
    out = out.filter((l) => set.has(l.qualification_status));
  }
  if (query.countries?.length) {
    const set = new Set(query.countries.map((c) => c.toLowerCase()));
    out = out.filter((l) => l.country !== null && set.has(l.country.toLowerCase()));
  }
  if (query.verticals?.length) {
    const set = new Set(query.verticals);
    out = out.filter((l) => l.vertical !== null && set.has(l.vertical));
  }
  if (query.segments?.length) {
    const set = new Set(query.segments);
    out = out.filter((l) => l.priority_segment !== null && set.has(l.priority_segment));
  }
  if (query.runId) {
    out = out.filter((l) => l.latest_run_id === query.runId || l.original_run_id === query.runId);
  }
  if (typeof query.minScore === 'number') {
    out = out.filter((l) => (l.fit_score ?? 0) >= query.minScore!);
  }
  if (query.firstSeenSince) {
    out = out.filter((l) => l.first_seen_at >= query.firstSeenSince!);
  }
  if (query.search) {
    const needle = query.search.toLowerCase();
    out = out.filter(
      (l) =>
        l.company_name.toLowerCase().includes(needle) ||
        (l.domain ?? '').includes(needle) ||
        (l.city ?? '').toLowerCase().includes(needle) ||
        (l.country ?? '').toLowerCase().includes(needle),
    );
  }

  out.sort(
    (a, b) =>
      (b.fit_score ?? -1) - (a.fit_score ?? -1) || a.company_name.localeCompare(b.company_name),
  );

  const offset = query.offset ?? 0;
  const limit = query.limit ?? out.length;
  return out.slice(offset, offset + limit);
}
