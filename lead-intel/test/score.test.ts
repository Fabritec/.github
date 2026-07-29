import assert from 'node:assert/strict';
import { test } from 'node:test';

import { emptyFacts } from '../src/lib/ai/schema.js';
import { postEnrichmentRules, preEnrichmentRules } from '../src/lib/icp/hard-rules.js';
import { computeConfidence, scoreCompany } from '../src/lib/icp/score.js';
import { buildCriteria } from '../src/lib/campaign-config.js';
import type { CompanyFacts, DiscoveredCompany } from '../src/lib/types.js';

function facts(partial: Partial<CompanyFacts> = {}): CompanyFacts {
  return { ...emptyFacts('test'), ...partial };
}

const strongSteelFacts = facts({
  vertical: 'steel',
  is_manufacturer: true,
  business_model: 'manufacturer',
  manufacturing_model: 'project_based',
  uses_drawings_boms_revisions: true,
  multi_stage_production: true,
  production_stages: ['cutting', 'fit-up', 'welding', 'painting'],
  has_qc_process: true,
  handles_shipping: true,
  handles_installation: true,
  employee_estimate: 120,
  detailing_software: ['Tekla Structures'],
  evidence: [
    { claim: 'a', finding: 'f', source_url: 'https://x.invalid/a', strength: 'strong' },
    { claim: 'b', finding: 'f', source_url: 'https://x.invalid/b', strength: 'strong' },
  ],
  confidence: 'high',
});

test('a project-based steel fabricator running Tekla lands in segment A', () => {
  const result = scoreCompany({ facts: strongSteelFacts, country: 'Saudi Arabia', contacts: [] });
  assert.equal(result.priority_segment, 'A');
  assert.equal(result.qualification_status, 'qualified');
  assert.ok(result.fit_score >= 80, `expected >= 80, got ${result.fit_score}`);
});

test('the wedge bonus is applied for Tekla and withheld otherwise', () => {
  const withTekla = scoreCompany({ facts: strongSteelFacts, country: 'Egypt', contacts: [] });
  const withoutTekla = scoreCompany({
    facts: { ...strongSteelFacts, detailing_software: [] },
    country: 'Egypt',
    contacts: [],
  });

  const bonus = withTekla.bonuses.find((b) => b.factor === 'wedge_detailing_software');
  assert.ok(bonus, 'expected a wedge bonus line');
  assert.equal(bonus.points, 10);
  assert.ok(
    withoutTekla.bonuses.every((b) => b.factor !== 'wedge_detailing_software'),
    'no wedge bonus without the software',
  );
  assert.ok(withTekla.fit_score > withoutTekla.fit_score);
});

test('scores never exceed 100 even when every bonus applies', () => {
  const maxed = scoreCompany({
    facts: {
      ...strongSteelFacts,
      plants: 4,
      named_projects: ['a', 'b', 'c', 'd'],
      manual_tracking_signals: ['spreadsheets', 'whiteboard'],
      production_stages: ['a', 'b', 'c', 'd', 'e', 'f'],
    },
    country: 'Saudi Arabia',
    contacts: [
      { persona_type: 'economic_buyer', email: 'a@x.invalid', email_status: 'verified' },
      { persona_type: 'operational_champion', email: 'b@x.invalid', email_status: 'verified' },
    ],
  });
  assert.equal(maxed.fit_score, 100);
});

test('a low-confidence lead that could still qualify goes to review, not the sheet', () => {
  const thin = facts({
    vertical: 'steel',
    is_manufacturer: true,
    business_model: 'manufacturer',
    manufacturing_model: 'project_based',
    uses_drawings_boms_revisions: true,
    multi_stage_production: true,
    production_stages: ['cutting', 'welding'],
    employee_estimate: 80,
    evidence: [{ claim: 'a', finding: 'f', source_url: null, strength: 'weak' }],
    confidence: 'low',
  });
  const result = scoreCompany({ facts: thin, country: 'Egypt', contacts: [] });
  assert.equal(result.qualification_status, 'review');
  assert.ok(result.confidence < 55);
});

test('a low-confidence lead with a hopeless score is rejected rather than queued', () => {
  const junk = facts({
    vertical: 'other',
    is_manufacturer: true,
    business_model: 'manufacturer',
    manufacturing_model: 'unknown',
    confidence: 'low',
    evidence: [],
  });
  const result = scoreCompany({ facts: junk, country: 'Germany', contacts: [] });
  assert.equal(result.qualification_status, 'rejected');
});

test('confidence is driven by evidence, not by how good the company looks', () => {
  const noEvidence = computeConfidence({ ...strongSteelFacts, evidence: [] });
  const withEvidence = computeConfidence(strongSteelFacts);
  assert.ok(
    withEvidence > noEvidence,
    `expected evidence to raise confidence (${noEvidence} -> ${withEvidence})`,
  );
  assert.ok(noEvidence < 55, 'a company with zero evidence must fall below the auto-qualify bar');
});

test('reachable decision-makers add points, unreachable ones add fewer', () => {
  const withVerified = scoreCompany({
    facts: strongSteelFacts,
    country: 'Qatar',
    contacts: [{ persona_type: 'economic_buyer', email: 'a@x.invalid', email_status: 'verified' }],
  });
  const withNone = scoreCompany({ facts: strongSteelFacts, country: 'Qatar', contacts: [] });

  const a = withVerified.breakdown.find((l) => l.factor === 'decision_maker')!;
  const b = withNone.breakdown.find((l) => l.factor === 'decision_maker')!;
  assert.ok(a.points > b.points);
});

test('geography tiers separate core, adjacent and outside markets', () => {
  const core = scoreCompany({ facts: strongSteelFacts, country: 'Egypt', contacts: [] });
  const adjacent = scoreCompany({ facts: strongSteelFacts, country: 'Jordan', contacts: [] });
  const outside = scoreCompany({ facts: strongSteelFacts, country: 'Vietnam', contacts: [] });

  const points = (r: typeof core) =>
    r.breakdown.find((l) => l.factor === 'size_geography')!.points;

  assert.ok(points(core) > points(adjacent));
  assert.ok(points(adjacent) > points(outside));
});

test('hard rules reject distributors, contractors and mass production', () => {
  const criteria = buildCriteria({ countries: [], verticals: [] });

  assert.equal(
    postEnrichmentRules(facts({ is_manufacturer: true, business_model: 'trader_distributor' }), criteria)
      .reasons.includes('Distributor only'),
    true,
  );
  assert.equal(
    postEnrichmentRules(facts({ is_manufacturer: true, business_model: 'contractor_only' }), criteria)
      .reasons.includes('Construction company without manufacturing'),
    true,
  );
  assert.equal(
    postEnrichmentRules(
      facts({ is_manufacturer: true, business_model: 'manufacturer', manufacturing_model: 'repetitive_mass' }),
      criteria,
    ).reasons.includes('Repetitive low-complexity production'),
    true,
  );
  assert.equal(
    postEnrichmentRules(facts({ is_manufacturer: false }), criteria).reasons.includes(
      'No evidence of in-house production',
    ),
    true,
  );
});

test('pre-enrichment rules drop obvious traders before any money is spent', () => {
  const criteria = buildCriteria({ countries: ['Egypt'] });
  const trader: DiscoveredCompany = {
    name: 'Cairo Steel Trading Co',
    website: null,
    domain: null,
    phone: null,
    address: null,
    city: 'Cairo',
    country: 'Egypt',
    source: 'google_places',
    source_url: null,
    provider_company_id: null,
    raw: {},
  };
  assert.equal(preEnrichmentRules(trader, criteria).passed, false);

  const outOfScope: DiscoveredCompany = { ...trader, name: 'Cairo Steel Fabrication', country: 'Kenya' };
  const result = preEnrichmentRules(outOfScope, criteria);
  assert.equal(result.passed, false);
  assert.ok(result.reasons.some((r) => r.includes('Outside target geography')));
});

test('the score breakdown accounts for every point awarded', () => {
  const result = scoreCompany({ facts: strongSteelFacts, country: 'Egypt', contacts: [] });
  const total =
    result.breakdown.reduce((s, l) => s + l.points, 0) +
    result.bonuses.reduce((s, l) => s + l.points, 0);
  assert.equal(result.fit_score, Math.min(100, total));
  for (const line of result.breakdown) {
    assert.ok(line.points <= line.max, `${line.factor} exceeded its max`);
    assert.ok(line.why.length > 0, `${line.factor} has no explanation`);
  }
});
