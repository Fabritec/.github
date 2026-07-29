/**
 * Fixtures for `--dry-run`.
 *
 * Every company here is invented. That is deliberate: fixtures must never carry
 * fabricated claims about a real business, because fixture rows and live rows
 * end up in the same store and the same spreadsheet. The names are chosen to be
 * obviously synthetic so a fixture row is recognisable at a glance in the sheet.
 *
 * The set is built to exercise the decision paths, not to look impressive:
 * a strong A-tier fit, a mid-tier B, a low-confidence review case, a trader that
 * the hard rules must reject, and a mass-production shop that must fail on
 * manufacturing model.
 */

import type { CampaignCriteria, CompanyFacts, DiscoveredCompany } from '../types.js';
import { emptyFacts } from '../ai/schema.js';
import type { FetchedPage } from './website.js';

interface Fixture {
  company: DiscoveredCompany;
  facts: CompanyFacts;
  pages: FetchedPage[];
}

function company(partial: Partial<DiscoveredCompany> & { name: string }): DiscoveredCompany {
  return {
    website: null,
    domain: null,
    phone: null,
    address: null,
    city: null,
    country: null,
    source: 'fixture',
    source_url: null,
    provider_company_id: null,
    raw: {},
    ...partial,
  };
}

function facts(partial: Partial<CompanyFacts>): CompanyFacts {
  return { ...emptyFacts('Fixture data.'), ...partial };
}

const FIXTURES: Fixture[] = [
  {
    // A-tier: project-based, Tekla, multi-stage, full evidence.
    company: company({
      name: 'Example Steel Industries (Sample)',
      website: 'https://example-steel-industries.invalid',
      domain: 'example-steel-industries.invalid',
      city: 'Riyadh',
      country: 'Saudi Arabia',
      phone: '+966 11 000 0000',
      provider_company_id: 'fixture-001',
    }),
    facts: facts({
      vertical: 'steel',
      is_manufacturer: true,
      business_model: 'manufacturer',
      manufacturing_model: 'project_based',
      uses_drawings_boms_revisions: true,
      multi_stage_production: true,
      production_stages: ['cutting', 'fit-up', 'welding', 'blasting', 'painting', 'dispatch'],
      has_qc_process: true,
      handles_shipping: true,
      handles_installation: true,
      detailing_software: ['Tekla Structures'],
      certifications: ['ISO 9001', 'AISC'],
      estimated_capacity_tpm: 600,
      plants: 2,
      employee_estimate: 180,
      countries_of_operation: ['Saudi Arabia', 'Bahrain'],
      manual_tracking_signals: ['Production status tracked on shared spreadsheets'],
      named_projects: ['Sample Terminal Expansion', 'Sample Industrial City Phase 2', 'Sample Stadium Roof'],
      pain_signals: [
        'Multiple simultaneous fabrication projects',
        'Drawing-driven production with revisions',
        'Quality and dispatch stages tracked separately',
      ],
      outreach_angle:
        'Connect Tekla detailing straight through to production tracking, QC and shipping readiness.',
      evidence: [
        {
          claim: 'project_based',
          finding: 'Capabilities page lists structural steel and PEB projects delivered to site.',
          source_url: 'https://example-steel-industries.invalid/capabilities',
          strength: 'strong',
        },
        {
          claim: 'detailing_software',
          finding: 'Engineering page states detailing is produced in Tekla Structures.',
          source_url: 'https://example-steel-industries.invalid/engineering',
          strength: 'strong',
        },
        {
          claim: 'multi_stage_production',
          finding: 'Facilities page describes cutting, fit-up, welding, blasting and painting bays.',
          source_url: 'https://example-steel-industries.invalid/facilities',
          strength: 'strong',
        },
      ],
      confidence: 'high',
      reasoning: 'Fixture: strong project-based steel fabricator with the wedge software present.',
    }),
    pages: [
      {
        url: 'https://example-steel-industries.invalid/capabilities',
        text: 'Sample capabilities page. Structural steel fabrication and pre-engineered buildings.',
      },
    ],
  },
  {
    // B-tier: real fabricator, no wedge software, thinner evidence.
    company: company({
      name: 'Sample Aluminium Works LLC',
      website: 'https://sample-aluminium-works.invalid',
      domain: 'sample-aluminium-works.invalid',
      city: 'Sharjah',
      country: 'United Arab Emirates',
      provider_company_id: 'fixture-002',
    }),
    facts: facts({
      vertical: 'aluminium',
      is_manufacturer: true,
      business_model: 'manufacturer',
      manufacturing_model: 'job_shop',
      uses_drawings_boms_revisions: true,
      multi_stage_production: true,
      production_stages: ['cutting', 'machining', 'assembly', 'finishing'],
      has_qc_process: true,
      handles_shipping: true,
      handles_installation: false,
      detailing_software: ['AutoCAD'],
      certifications: ['ISO 9001'],
      estimated_capacity_tpm: 120,
      plants: 1,
      employee_estimate: 65,
      countries_of_operation: ['United Arab Emirates'],
      manual_tracking_signals: ['Job cards issued per order'],
      named_projects: ['Sample Tower Facade'],
      pain_signals: ['Custom orders with per-job drawings', 'Manual job-card tracking'],
      outreach_angle: 'Replace paper job cards with live shop-floor status per order.',
      evidence: [
        {
          claim: 'is_manufacturer',
          finding: 'About page describes an in-house fabrication workshop with CNC machining.',
          source_url: 'https://sample-aluminium-works.invalid/about',
          strength: 'strong',
        },
        {
          claim: 'manufacturing_model',
          finding: 'Services page describes bespoke fabrication to customer drawings.',
          source_url: 'https://sample-aluminium-works.invalid/services',
          strength: 'moderate',
        },
      ],
      confidence: 'medium',
      reasoning: 'Fixture: mid-tier aluminium job shop without the wedge software.',
    }),
    pages: [],
  },
  {
    // Review case: plausible but almost nothing to back it up.
    company: company({
      name: 'Placeholder Fabrication Est.',
      website: 'https://placeholder-fabrication.invalid',
      domain: 'placeholder-fabrication.invalid',
      city: 'Cairo',
      country: 'Egypt',
      provider_company_id: 'fixture-003',
    }),
    facts: facts({
      vertical: 'steel',
      is_manufacturer: true,
      business_model: 'manufacturer',
      manufacturing_model: 'unknown',
      uses_drawings_boms_revisions: false,
      multi_stage_production: false,
      production_stages: [],
      detailing_software: [],
      estimated_capacity_tpm: null,
      plants: null,
      employee_estimate: null,
      pain_signals: [],
      outreach_angle: 'Unclear — needs a call to establish what they actually produce.',
      evidence: [
        {
          claim: 'is_manufacturer',
          finding: 'Single-page site says "steel fabrication" with no further detail.',
          source_url: 'https://placeholder-fabrication.invalid/',
          strength: 'weak',
        },
      ],
      confidence: 'low',
      reasoning: 'Fixture: thin landing page, not enough to qualify or reject.',
    }),
    pages: [],
  },
  {
    // Must be rejected by the hard rules: trading, not manufacturing.
    company: company({
      name: 'Sample Metal Trading Co',
      website: 'https://sample-metal-trading.invalid',
      domain: 'sample-metal-trading.invalid',
      city: 'Dubai',
      country: 'United Arab Emirates',
      provider_company_id: 'fixture-004',
    }),
    facts: facts({
      vertical: 'other',
      is_manufacturer: false,
      business_model: 'trader_distributor',
      manufacturing_model: 'unknown',
      disqualifiers: ['Stocks and resells imported steel sections; no production facility'],
      evidence: [
        {
          claim: 'business_model',
          finding: 'Site describes stockholding and distribution of imported sections.',
          source_url: 'https://sample-metal-trading.invalid/',
          strength: 'strong',
        },
      ],
      confidence: 'high',
      reasoning: 'Fixture: distributor, must be rejected by the hard rules.',
    }),
    pages: [],
  },
  {
    // Must be rejected on manufacturing model: repetitive mass production.
    company: company({
      name: 'Sample Wire Products Factory',
      website: 'https://sample-wire-products.invalid',
      domain: 'sample-wire-products.invalid',
      city: 'Alexandria',
      country: 'Egypt',
      provider_company_id: 'fixture-005',
    }),
    facts: facts({
      vertical: 'other',
      is_manufacturer: true,
      business_model: 'manufacturer',
      manufacturing_model: 'repetitive_mass',
      multi_stage_production: true,
      production_stages: ['drawing', 'galvanising', 'packing'],
      employee_estimate: 90,
      evidence: [
        {
          claim: 'manufacturing_model',
          finding: 'Produces a standard catalogue of wire mesh continuously.',
          source_url: 'https://sample-wire-products.invalid/products',
          strength: 'strong',
        },
      ],
      confidence: 'high',
      reasoning: 'Fixture: continuous production of a standard catalogue, poor fit.',
    }),
    pages: [],
  },
];

const BY_KEY = new Map<string, Fixture>(
  FIXTURES.map((f) => [f.company.provider_company_id ?? f.company.name, f]),
);

function keyOf(target: DiscoveredCompany): string {
  return target.provider_company_id ?? target.name;
}

export function loadFixtureCompanies(criteria: CampaignCriteria): DiscoveredCompany[] {
  const countries = criteria.countries.map((c) => c.toLowerCase());
  return FIXTURES.map((f) => f.company).filter(
    (c) =>
      countries.length === 0 ||
      (c.country !== null && countries.includes(c.country.toLowerCase())),
  );
}

export function fixtureFactsFor(target: DiscoveredCompany): CompanyFacts {
  return (
    BY_KEY.get(keyOf(target))?.facts ??
    emptyFacts('No fixture defined for this company.')
  );
}

export function fixturePagesFor(target: DiscoveredCompany): FetchedPage[] {
  return BY_KEY.get(keyOf(target))?.pages ?? [];
}
