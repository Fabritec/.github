import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dedupeBatch, diffLead } from '../src/lib/pipeline/dedupe.js';
import { normaliseCompanyName, normaliseDomain, normaliseEmail } from '../src/lib/util.js';
import { buildSegmentKey, groupIntoSegments, segmentPartsFor } from '../src/lib/icp/segments.js';
import { parseCompanyList, parseCsv } from '../src/lib/sources/import-list.js';
import type { DiscoveredCompany, Lead } from '../src/lib/types.js';

function company(partial: Partial<DiscoveredCompany> & { name: string }): DiscoveredCompany {
  return {
    website: null,
    domain: null,
    phone: null,
    address: null,
    city: null,
    country: null,
    source: 'google_places',
    source_url: null,
    provider_company_id: null,
    raw: {},
    ...partial,
  };
}

test('domain normalisation strips scheme, www and path', () => {
  assert.equal(normaliseDomain('https://www.Example-Steel.com/about?x=1'), 'example-steel.com');
  assert.equal(normaliseDomain('example-steel.com'), 'example-steel.com');
  assert.equal(normaliseDomain('http://EXAMPLE-STEEL.COM.'), 'example-steel.com');
  assert.equal(normaliseDomain('not a url'), null);
  assert.equal(normaliseDomain(null), null);
});

test('company-name normalisation ignores legal suffixes', () => {
  assert.equal(
    normaliseCompanyName('Al Rajhi Steel Industries LLC'),
    normaliseCompanyName('Al-Rajhi Steel Co.'),
  );
  assert.notEqual(normaliseCompanyName('Delta Steel'), normaliseCompanyName('Delta Precast'));
});

test('the same factory found twice by domain collapses into one lead', () => {
  const { unique, removed } = dedupeBatch([
    company({ name: 'Example Steel', website: 'https://www.example-steel.invalid' }),
    company({ name: 'Example Steel Industries', website: 'http://example-steel.invalid/about' }),
  ]);
  assert.equal(unique.length, 1);
  assert.equal(removed, 1);
});

test('duplicates fill in gaps rather than being thrown away', () => {
  const { unique } = dedupeBatch([
    company({ name: 'Example Steel', website: 'https://example-steel.invalid' }),
    company({
      name: 'Example Steel',
      website: 'https://example-steel.invalid',
      phone: '+20 100 000 0000',
      city: 'Cairo',
    }),
  ]);
  assert.equal(unique.length, 1);
  assert.equal(unique[0]!.phone, '+20 100 000 0000');
  assert.equal(unique[0]!.city, 'Cairo');
});

test('same name in different countries stays two companies', () => {
  const { unique } = dedupeBatch([
    company({ name: 'Gulf Steel Works', country: 'Qatar' }),
    company({ name: 'Gulf Steel Works', country: 'Oman' }),
  ]);
  assert.equal(unique.length, 2);
});

test('provider id matches even when the domain is missing', () => {
  const { unique, removed } = dedupeBatch([
    company({ name: 'Some Factory', provider_company_id: 'places-123' }),
    company({ name: 'Some Factory Ltd', provider_company_id: 'places-123', country: 'Egypt' }),
  ]);
  assert.equal(unique.length, 1);
  assert.equal(removed, 1);
});

test('email normalisation rejects malformed addresses', () => {
  assert.equal(normaliseEmail('  Ahmed@Example.INVALID '), 'ahmed@example.invalid');
  assert.equal(normaliseEmail('not-an-email'), null);
  assert.equal(normaliseEmail(null), null);
});

function lead(partial: Partial<Lead> = {}): Lead {
  return {
    id: 'id',
    lead_ref: 'FAB-L-1',
    company_name: 'Example Steel',
    website: null,
    domain: 'example-steel.invalid',
    country: 'Egypt',
    city: 'Cairo',
    address: null,
    phone: null,
    industry: null,
    vertical: 'steel',
    icp_segment: 'Tier 1 - Metal and Steel Fabrication',
    segment_key: null,
    capacity_band: 'mid',
    employee_range: '100-249',
    manufacturing_model: 'project_based',
    fit_score: 70,
    confidence: 70,
    priority_segment: 'B',
    qualification_status: 'qualified',
    qualification_reason: null,
    pain_signals: [],
    outreach_angle: null,
    rejection_reasons: [],
    detailing_software: [],
    source: 'google_places',
    source_url: null,
    provider_company_id: null,
    first_seen_at: '2026-01-01T00:00:00.000Z',
    last_seen_at: '2026-01-01T00:00:00.000Z',
    last_enriched_at: null,
    original_run_id: 'run-1',
    latest_run_id: 'run-1',
    previous_score: null,
    current_score: 70,
    changed_fields: [],
    crm_status: 'new',
    assigned_to: null,
    notes: null,
    facts: null,
    score_breakdown: null,
    ...partial,
  };
}

test('the diff reports exactly the fields that moved', () => {
  const before = lead();
  const after = lead({ fit_score: 88, priority_segment: 'A', city: 'Cairo' });
  const changed = diffLead(before, after);
  assert.deepEqual(changed.sort(), ['fit_score', 'priority_segment']);
});

test('an unchanged lead produces an empty diff', () => {
  assert.deepEqual(diffLead(lead(), lead()), []);
});

test('segments are derived from vertical, country, capacity and tier', () => {
  const key = buildSegmentKey(
    segmentPartsFor({
      vertical: 'steel',
      country: 'Saudi Arabia',
      facts: { estimated_capacity_tpm: 600 },
      priority_segment: 'A',
    }),
  );
  assert.equal(key, 'steel|saudi-arabia|mid|A');
});

test('grouping puts leads in their derived buckets', () => {
  const groups = groupIntoSegments([
    lead({ id: '1', segment_key: 'steel|egypt|mid|A', fit_score: 90 }),
    lead({ id: '2', segment_key: 'steel|egypt|mid|A', fit_score: 82 }),
    lead({ id: '3', segment_key: 'precast|qatar|small|B', fit_score: 70 }),
  ]);
  assert.equal(groups.length, 2);
  const steel = groups.find((g) => g.key === 'steel|egypt|mid|A')!;
  assert.equal(steel.count, 2);
  assert.equal(steel.avg_score, 86);
  assert.equal(steel.leads[0]!.fit_score, 90);
});

test('CSV parsing handles quotes, embedded commas and newlines', () => {
  const rows = parseCsv('a,b\n"x,1","line1\nline2"\n');
  assert.deepEqual(rows, [
    ['a', 'b'],
    ['x,1', 'line1\nline2'],
  ]);
});

test('exhibitor lists import with flexible headers', () => {
  const csv = [
    'Exhibitor,Web Site,Country,Stand',
    'Example Fabricators,https://www.example-fab.invalid,United Arab Emirates,Hall 3 B12',
    'Sample Precast,sample-precast.invalid,Qatar,Hall 1 A4',
  ].join('\n');

  const companies = parseCompanyList(csv, { source: 'exhibitor_import' });
  assert.equal(companies.length, 2);
  assert.equal(companies[0]!.name, 'Example Fabricators');
  assert.equal(companies[0]!.domain, 'example-fab.invalid');
  assert.equal(companies[0]!.country, 'United Arab Emirates');
  assert.equal(companies[0]!.source, 'exhibitor_import');
  assert.equal(companies[1]!.domain, 'sample-precast.invalid');
});

test('an import without a company-name column fails loudly', () => {
  assert.throws(() => parseCompanyList('foo,bar\n1,2'), /company-name column/);
});
