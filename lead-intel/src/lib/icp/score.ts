/**
 * Turns `CompanyFacts` into a fit score, a confidence score and a qualification
 * decision. Pure and synchronous — no I/O, no model calls — so it can be unit
 * tested and replayed over stored facts when the rubric changes.
 */

import type {
  CompanyFacts,
  Contact,
  PrioritySegment,
  QualificationStatus,
  ScoreLine,
  ScoreResult,
} from '../types.js';
import { geographyTier } from './hard-rules.js';
import {
  BONUSES,
  EMPLOYEE_SWEET_SPOT,
  MIN_CONFIDENCE_FOR_AUTO_QUALIFY,
  NO_EVIDENCE_CONFIDENCE_CAP,
  OTHER_DETAILING_SOFTWARE,
  REVIEW_SCORE_FLOOR,
  RUBRIC,
  VERTICAL_FIT,
  WEDGE_SOFTWARE,
  segmentForScore,
} from './rubric.js';

export interface ScoreInput {
  facts: CompanyFacts;
  country: string | null;
  contacts: Pick<Contact, 'persona_type' | 'email' | 'email_status'>[];
}

function maxFor(key: string): number {
  return RUBRIC.find((f) => f.key === key)?.max ?? 0;
}

function line(key: string, points: number, why: string): ScoreLine {
  const factor = RUBRIC.find((f) => f.key === key);
  return {
    factor: key,
    label: factor?.label ?? key,
    points: Math.max(0, Math.min(points, factor?.max ?? points)),
    max: factor?.max ?? 0,
    why,
  };
}

function matchesAny(values: string[], needles: string[]): string[] {
  const lowered = values.map((v) => v.toLowerCase());
  return needles.filter((n) => lowered.some((v) => v.includes(n)));
}

/** True when the company runs software whose output Fabritec ingests directly. */
export function hasWedgeSoftware(detailingSoftware: string[]): boolean {
  return matchesAny(detailingSoftware, WEDGE_SOFTWARE).length > 0;
}

function scoreIndustryFit(facts: CompanyFacts): ScoreLine {
  const fit = VERTICAL_FIT[facts.vertical];
  return line(
    'industry_fit',
    fit.points,
    `Vertical "${facts.vertical}" maps to ${fit.segment}`,
  );
}

function scoreProductionModel(facts: CompanyFacts): ScoreLine {
  const max = maxFor('production_model');
  switch (facts.manufacturing_model) {
    case 'project_based':
      return line('production_model', max, 'Project-based production');
    case 'job_shop':
      return line('production_model', max - 2, 'Job-shop production');
    case 'make_to_order':
      return line('production_model', max - 4, 'Make-to-order production');
    case 'repetitive_mass':
      return line('production_model', 0, 'Repetitive mass production — poor fit');
    default:
      return line('production_model', 4, 'Production model could not be determined');
  }
}

function scoreDrawings(facts: CompanyFacts): ScoreLine {
  const max = maxFor('drawings_boms');
  if (!facts.uses_drawings_boms_revisions) {
    return line('drawings_boms', 0, 'No evidence of drawing-, BOM- or revision-driven work');
  }
  const wedge = hasWedgeSoftware(facts.detailing_software);
  const points = wedge ? max : max - 3;
  return line(
    'drawings_boms',
    points,
    wedge
      ? `Drawing-driven, detailing in ${facts.detailing_software.join(', ')}`
      : 'Drawing-, BOM- or revision-driven production',
  );
}

function scoreMultiStage(facts: CompanyFacts): ScoreLine {
  const max = maxFor('multi_stage');
  if (!facts.multi_stage_production) {
    return line('multi_stage', 0, 'Single-stage or unclear production flow');
  }
  const stages = facts.production_stages.length;
  if (stages >= 4) {
    return line('multi_stage', max, `${stages} named production stages`);
  }
  if (stages >= 2) {
    return line('multi_stage', max - 4, `${stages} named production stages`);
  }
  return line('multi_stage', max - 7, 'Multi-stage production asserted but stages not named');
}

function scoreQcLogistics(facts: CompanyFacts): ScoreLine {
  const max = maxFor('qc_logistics');
  const parts: string[] = [];
  let points = 0;
  if (facts.has_qc_process) {
    points += 4;
    parts.push('QC process');
  }
  if (facts.handles_shipping) {
    points += 3;
    parts.push('dispatch/shipping');
  }
  if (facts.handles_installation) {
    points += 3;
    parts.push('site installation/erection');
  }
  return line(
    'qc_logistics',
    Math.min(points, max),
    parts.length > 0 ? `Handles ${parts.join(', ')}` : 'No QC, shipping or installation signals',
  );
}

function scoreSizeGeography(facts: CompanyFacts, country: string | null): ScoreLine {
  const max = maxFor('size_geography');
  let points = 0;
  const parts: string[] = [];

  const tier = geographyTier(country);
  if (tier === 'core') {
    points += 5;
    parts.push(`${country} is a core market`);
  } else if (tier === 'adjacent') {
    points += 3;
    parts.push(`${country} is an adjacent market`);
  } else {
    parts.push(country ? `${country} is outside core markets` : 'Country unknown');
  }

  const employees = facts.employee_estimate;
  if (employees === null) {
    points += 1;
    parts.push('headcount unknown');
  } else if (employees >= EMPLOYEE_SWEET_SPOT.min && employees <= EMPLOYEE_SWEET_SPOT.max) {
    points += 5;
    parts.push(`${employees} employees is in the target band`);
  } else if (employees > EMPLOYEE_SWEET_SPOT.max) {
    points += 3;
    parts.push(`${employees} employees — enterprise cycle likely`);
  } else {
    points += 1;
    parts.push(`${employees} employees — below target band`);
  }

  return line('size_geography', Math.min(points, max), parts.join('; '));
}

function scoreManualTracking(facts: CompanyFacts): ScoreLine {
  const max = maxFor('manual_tracking');
  const signals = facts.manual_tracking_signals.length;
  if (signals === 0) {
    return line('manual_tracking', 0, 'No visible manual/Excel tracking signals');
  }
  return line(
    'manual_tracking',
    Math.min(signals * 2 + 1, max),
    `${signals} manual-tracking signal(s): ${facts.manual_tracking_signals.join('; ')}`,
  );
}

function scoreDecisionMaker(input: ScoreInput): ScoreLine {
  const max = maxFor('decision_maker');
  const contacts = input.contacts;
  if (contacts.length === 0) {
    return line('decision_maker', 0, 'No decision-maker identified yet');
  }
  const hasEconomic = contacts.some((c) => c.persona_type === 'economic_buyer');
  const hasChampion = contacts.some((c) => c.persona_type === 'operational_champion');
  const hasReachable = contacts.some(
    (c) => c.email !== null && (c.email_status === 'verified' || c.email_status === 'accept_all'),
  );

  let points = 1;
  const parts: string[] = [`${contacts.length} contact(s) found`];
  if (hasEconomic) {
    points += 2;
    parts.push('economic buyer identified');
  }
  if (hasChampion) {
    points += 1;
    parts.push('operational champion identified');
  }
  if (hasReachable) {
    points += 1;
    parts.push('at least one deliverable email');
  }
  return line('decision_maker', Math.min(points, max), parts.join('; '));
}

function scoreEvidenceStrength(facts: CompanyFacts): ScoreLine {
  const max = maxFor('evidence_strength');
  const strong = facts.evidence.filter((e) => e.strength === 'strong').length;
  const moderate = facts.evidence.filter((e) => e.strength === 'moderate').length;
  const sourced = facts.evidence.filter((e) => e.source_url !== null).length;
  const points = Math.min(strong * 2 + moderate + (sourced > 0 ? 1 : 0), max);
  return line(
    'evidence_strength',
    points,
    `${facts.evidence.length} evidence item(s): ${strong} strong, ${moderate} moderate, ${sourced} with a source URL`,
  );
}

function computeBonuses(facts: CompanyFacts): ScoreLine[] {
  const bonuses: ScoreLine[] = [];

  const wedge = matchesAny(facts.detailing_software, WEDGE_SOFTWARE);
  if (wedge.length > 0) {
    bonuses.push({
      factor: 'wedge_detailing_software',
      label: 'Runs Tekla / Advance Steel (XSR ingestion wedge)',
      points: BONUSES.wedgeDetailingSoftware,
      max: BONUSES.wedgeDetailingSoftware,
      why: `Detected: ${facts.detailing_software.join(', ')}`,
    });
  } else {
    const other = matchesAny(facts.detailing_software, OTHER_DETAILING_SOFTWARE);
    if (other.length > 0) {
      bonuses.push({
        factor: 'other_detailing_software',
        label: 'Runs other detailing/CAD software',
        points: BONUSES.otherDetailingSoftware,
        max: BONUSES.otherDetailingSoftware,
        why: `Detected: ${facts.detailing_software.join(', ')}`,
      });
    }
  }

  if (facts.named_projects.length >= 3) {
    bonuses.push({
      factor: 'named_project_portfolio',
      label: 'Published portfolio of named projects',
      points: BONUSES.namedProjectPortfolio,
      max: BONUSES.namedProjectPortfolio,
      why: `${facts.named_projects.length} named projects`,
    });
  }

  if ((facts.plants ?? 0) >= 2) {
    bonuses.push({
      factor: 'multi_plant',
      label: 'Multiple production plants',
      points: BONUSES.multiPlant,
      max: BONUSES.multiPlant,
      why: `${facts.plants} plants`,
    });
  }

  return bonuses;
}

/**
 * Confidence answers "how much should we trust this score", not "how good is
 * the lead". A perfect-looking company with one weak evidence item is exactly
 * the case this is meant to catch.
 */
export function computeConfidence(facts: CompanyFacts): number {
  const base = { high: 70, medium: 50, low: 28 }[facts.confidence];

  const strong = facts.evidence.filter((e) => e.strength === 'strong').length;
  const moderate = facts.evidence.filter((e) => e.strength === 'moderate').length;
  const sourced = facts.evidence.filter((e) => e.source_url !== null).length;

  const evidencePoints = Math.min(strong * 6 + moderate * 3, 20);
  const sourcePoints = Math.min(sourced * 2, 6);

  // Completeness of the fields the rubric actually leans on.
  const keyFields = [
    facts.vertical !== 'other',
    facts.business_model !== 'unknown',
    facts.manufacturing_model !== 'unknown',
    facts.production_stages.length > 0,
    facts.employee_estimate !== null,
    facts.detailing_software.length > 0,
  ];
  const completeness = Math.round((keyFields.filter(Boolean).length / keyFields.length) * 10);

  const score = clamp(base + evidencePoints + sourcePoints + completeness);

  return facts.evidence.length === 0
    ? Math.min(score, NO_EVIDENCE_CONFIDENCE_CAP)
    : score;
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

export function scoreCompany(input: ScoreInput): ScoreResult {
  const { facts, country } = input;

  const breakdown: ScoreLine[] = [
    scoreIndustryFit(facts),
    scoreProductionModel(facts),
    scoreDrawings(facts),
    scoreMultiStage(facts),
    scoreQcLogistics(facts),
    scoreSizeGeography(facts, country),
    scoreManualTracking(facts),
    scoreDecisionMaker(input),
    scoreEvidenceStrength(facts),
  ];

  const bonuses = computeBonuses(facts);

  const base = breakdown.reduce((sum, l) => sum + l.points, 0);
  const bonusTotal = bonuses.reduce((sum, l) => sum + l.points, 0);
  const fit_score = clamp(base + bonusTotal);
  const confidence = computeConfidence(facts);

  const { segment } = segmentForScore(fit_score);
  const { status, reason, rejection_reasons } = decide(fit_score, confidence, segment, facts);

  return {
    fit_score,
    confidence,
    breakdown,
    bonuses,
    priority_segment: segment,
    qualification_status: status,
    qualification_reason: reason,
    rejection_reasons,
  };
}

function decide(
  fitScore: number,
  confidence: number,
  segment: PrioritySegment,
  facts: CompanyFacts,
): { status: QualificationStatus; reason: string; rejection_reasons: string[] } {
  const topFactors = [...facts.pain_signals].slice(0, 3);

  if (confidence < MIN_CONFIDENCE_FOR_AUTO_QUALIFY) {
    if (fitScore < REVIEW_SCORE_FLOOR) {
      return {
        status: 'rejected',
        reason: `Fit score ${fitScore} with confidence ${confidence} — too weak on both counts to be worth a human look.`,
        rejection_reasons: ['Insufficient evidence and low fit score'],
      };
    }
    return {
      status: 'review',
      reason: `Fit score ${fitScore} but confidence only ${confidence} — needs human review before outreach.`,
      rejection_reasons: [],
    };
  }

  if (segment === 'D') {
    return {
      status: 'rejected',
      reason: `Fit score ${fitScore} is below the qualification floor.`,
      rejection_reasons: ['Score below 50 — insufficient operational complexity for Fabritec'],
    };
  }

  if (segment === 'C') {
    return {
      status: 'nurture',
      reason: `Fit score ${fitScore} (segment C). ${topFactors.join('; ') || 'Partial ICP match.'}`,
      rejection_reasons: [],
    };
  }

  return {
    status: 'qualified',
    reason: `Fit score ${fitScore} (segment ${segment}), confidence ${confidence}. ${
      topFactors.join('; ') || 'Meets ICP criteria.'
    }`,
    rejection_reasons: [],
  };
}
