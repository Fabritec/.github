/**
 * Hard qualification rules run *before* scoring. They are cheap, deterministic
 * and non-negotiable: a trading company does not become a fit because it scored
 * well on evidence strength.
 */

import type { CampaignCriteria, CompanyFacts, DiscoveredCompany } from '../types.js';
import { CORE_COUNTRIES, ADJACENT_COUNTRIES } from './rubric.js';

export interface HardRuleResult {
  passed: boolean;
  reasons: string[];
}

const TRADER_HINTS = [
  'trading',
  'trader',
  'distributor',
  'distribution',
  'wholesale',
  'importer',
  'stockist',
  'supplies',
  'general supplies',
];

/**
 * Pre-enrichment gate. Runs on the discovery shell alone, so it can drop obvious
 * misses before we spend a website fetch and a model call on them.
 */
export function preEnrichmentRules(
  company: DiscoveredCompany,
  criteria: CampaignCriteria,
): HardRuleResult {
  const reasons: string[] = [];
  const name = company.name.toLowerCase();

  if (!company.name.trim()) {
    reasons.push('Missing company name');
  }

  for (const term of criteria.exclude) {
    if (name.includes(term.toLowerCase())) {
      reasons.push(`Name matches campaign exclusion "${term}"`);
    }
  }

  if (TRADER_HINTS.some((h) => name.includes(h))) {
    reasons.push('Company name indicates trading or distribution, not manufacturing');
  }

  if (criteria.countries.length > 0 && company.country) {
    const inScope = criteria.countries.some(
      (c) => c.toLowerCase() === company.country?.toLowerCase(),
    );
    if (!inScope) {
      reasons.push(`Outside target geography (${company.country})`);
    }
  }

  return { passed: reasons.length === 0, reasons };
}

/**
 * Post-enrichment gate. Runs on model-extracted facts. Anything failing here is
 * rejected outright and never reaches the scoring rubric.
 */
export function postEnrichmentRules(
  facts: CompanyFacts,
  criteria: CampaignCriteria,
): HardRuleResult {
  const reasons: string[] = [];

  if (!facts.is_manufacturer) {
    reasons.push('No evidence of in-house production');
  }

  if (facts.business_model === 'trader_distributor') {
    reasons.push('Distributor only');
  }

  if (facts.business_model === 'contractor_only') {
    reasons.push('Construction company without manufacturing');
  }

  if (facts.manufacturing_model === 'repetitive_mass') {
    reasons.push('Repetitive low-complexity production');
  }

  const employees = facts.employee_estimate;
  if (employees !== null && criteria.employees_min !== null && employees < criteria.employees_min) {
    reasons.push(`Too small (${employees} employees)`);
  }
  if (employees !== null && criteria.employees_max !== null && employees > criteria.employees_max) {
    reasons.push(`Above target size band (${employees} employees)`);
  }

  if (criteria.verticals.length > 0 && !criteria.verticals.includes(facts.vertical)) {
    reasons.push(`Vertical "${facts.vertical}" not in campaign scope`);
  }

  if (facts.disqualifiers.length > 0) {
    reasons.push(...facts.disqualifiers);
  }

  return { passed: reasons.length === 0, reasons };
}

export function geographyTier(country: string | null): 'core' | 'adjacent' | 'outside' {
  if (!country) return 'outside';
  const c = country.trim().toLowerCase();
  if (CORE_COUNTRIES.some((x) => x.toLowerCase() === c)) return 'core';
  if (ADJACENT_COUNTRIES.some((x) => x.toLowerCase() === c)) return 'adjacent';
  return 'outside';
}
