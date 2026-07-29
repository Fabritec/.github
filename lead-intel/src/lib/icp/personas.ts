/**
 * Maps job titles onto Fabritec's buying committee. The pipeline aims for two
 * to four contacts per company — one economic buyer, one operational champion,
 * one technical influencer, one alternate — rather than one random person.
 */

import type { PersonaType } from '../types.js';

interface PersonaRule {
  persona: PersonaType;
  /** Lower-cased substrings matched against the job title. */
  patterns: string[];
  /** Base contact score before email/seniority adjustments. */
  weight: number;
}

const RULES: PersonaRule[] = [
  {
    persona: 'economic_buyer',
    patterns: [
      'owner',
      'founder',
      'co-founder',
      'chairman',
      'managing director',
      'general manager',
      'ceo',
      'chief executive',
      'president',
      'partner',
      'board member',
    ],
    weight: 90,
  },
  {
    persona: 'operational_champion',
    patterns: [
      'operations manager',
      'operations director',
      'head of operations',
      'coo',
      'production manager',
      'production director',
      'head of production',
      'production planning',
      'planning manager',
      'plant manager',
      'factory manager',
      'works manager',
      'project manager',
      'projects manager',
      'project director',
      'workshop manager',
    ],
    weight: 85,
  },
  {
    persona: 'technical_influencer',
    patterns: [
      'quality manager',
      'qa/qc',
      'qaqc',
      'qc manager',
      'quality control',
      'quality assurance',
      'engineering manager',
      'head of engineering',
      'technical manager',
      'technical director',
      'design manager',
      'detailing manager',
      'draughting',
      'drafting manager',
      'logistics manager',
      'dispatch manager',
      'shipping manager',
      'it manager',
      'head of it',
      'cto',
      'digital transformation',
    ],
    weight: 70,
  },
  {
    persona: 'alternate',
    patterns: [
      'business development',
      'commercial manager',
      'sales manager',
      'estimation',
      'estimator',
      'contracts manager',
      'procurement',
      'supply chain',
      'finance manager',
      'admin manager',
    ],
    weight: 45,
  },
];

/** The default title list handed to the people-search provider. */
export const DEFAULT_TARGET_ROLES = [
  'Owner',
  'Founder',
  'Managing Director',
  'General Manager',
  'Operations Manager',
  'Production Manager',
  'Production Planning Manager',
  'Project Manager',
  'Plant Manager',
  'Quality Manager',
  'Engineering Manager',
  'Technical Manager',
  'Logistics Manager',
  'IT Manager',
];

export function classifyPersona(jobTitle: string | null): PersonaType {
  if (!jobTitle) return 'unknown';
  const title = jobTitle.toLowerCase();
  for (const rule of RULES) {
    if (rule.patterns.some((p) => title.includes(p))) return rule.persona;
  }
  return 'unknown';
}

export function personaWeight(persona: PersonaType): number {
  return RULES.find((r) => r.persona === persona)?.weight ?? 25;
}

export function personaLabel(persona: PersonaType): string {
  switch (persona) {
    case 'economic_buyer':
      return 'Economic buyer';
    case 'operational_champion':
      return 'Operational champion';
    case 'technical_influencer':
      return 'Technical influencer';
    case 'alternate':
      return 'Alternate contact';
    default:
      return 'Unclassified';
  }
}

export interface ContactScoreInput {
  persona_type: PersonaType;
  email: string | null;
  email_status: string;
  phone: string | null;
  profile_url: string | null;
}

/** Reachability matters as much as seniority — an unreachable owner is worth little. */
export function scoreContact(input: ContactScoreInput): number {
  let score = personaWeight(input.persona_type);

  switch (input.email_status) {
    case 'verified':
      score += 10;
      break;
    case 'accept_all':
      score += 4;
      break;
    case 'invalid':
      score -= 25;
      break;
    case 'unverified':
      score -= 5;
      break;
    default:
      score -= 10;
  }

  if (!input.email) score -= 20;
  if (input.phone) score += 4;
  if (input.profile_url) score += 3;

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Picks the contacts worth keeping: best per persona first so the committee is
 * covered, then the next best overall to fill the quota.
 */
export function selectCommittee<T extends { persona_type: PersonaType; contact_score: number }>(
  contacts: T[],
  limit: number,
): T[] {
  const order: PersonaType[] = [
    'economic_buyer',
    'operational_champion',
    'technical_influencer',
    'alternate',
  ];
  const ranked = [...contacts].sort((a, b) => b.contact_score - a.contact_score);
  const picked: T[] = [];

  for (const persona of order) {
    if (picked.length >= limit) break;
    const best = ranked.find((c) => c.persona_type === persona && !picked.includes(c));
    if (best) picked.push(best);
  }

  for (const contact of ranked) {
    if (picked.length >= limit) break;
    if (!picked.includes(contact)) picked.push(contact);
  }

  return picked.slice(0, limit);
}
