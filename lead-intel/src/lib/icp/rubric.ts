/**
 * The scoring rubric lives here, in code, and nowhere else.
 *
 * The model is never asked "how good is this lead" — it returns facts, and this
 * rubric turns facts into a number. That means a rubric change can be replayed
 * over stored facts without re-running (and re-paying for) enrichment.
 */

import type { CapacityBand, PrioritySegment, Vertical } from '../types.js';

export interface RubricFactor {
  key: string;
  label: string;
  max: number;
}

/** Base rubric, 100 points. */
export const RUBRIC: RubricFactor[] = [
  { key: 'industry_fit', label: 'Industry and ICP fit', max: 20 },
  { key: 'production_model', label: 'Project-, job- or order-based manufacturing', max: 15 },
  { key: 'drawings_boms', label: 'Uses drawings, BOMs or revisions', max: 15 },
  { key: 'multi_stage', label: 'Multi-stage production complexity', max: 15 },
  { key: 'qc_logistics', label: 'QC, shipping or installation complexity', max: 10 },
  { key: 'size_geography', label: 'Company size and geography', max: 10 },
  { key: 'manual_tracking', label: 'Signs of Excel/manual tracking', max: 5 },
  { key: 'decision_maker', label: 'Appropriate decision-maker available', max: 5 },
  { key: 'evidence_strength', label: 'Strength of available evidence', max: 5 },
];

export const RUBRIC_TOTAL = RUBRIC.reduce((sum, f) => sum + f.max, 0);

/**
 * Fabritec-specific bonuses applied on top of the base rubric, then capped at
 * 100. Detailing-software detection is weighted hard on purpose: XSR ingestion
 * is the wedge, so a shop already running Tekla or Advance Steel is a shorter
 * sale than an otherwise identical shop that is not.
 */
export const BONUSES = {
  /** Tekla Structures or Autodesk Advance Steel named anywhere on the site. */
  wedgeDetailingSoftware: 10,
  /** Any other detailing/CAM package (SDS/2, StruMIS, Bocad, Tecnometal…). */
  otherDetailingSoftware: 4,
  /** Named project portfolio — reliable proxy for project-based operation. */
  namedProjectPortfolio: 3,
  /** Multiple plants: more coordination pain, bigger deal. */
  multiPlant: 3,
} as const;

/** Software names that trigger the wedge bonus, matched case-insensitively. */
export const WEDGE_SOFTWARE = ['tekla', 'advance steel', 'advancesteel', 'xsr'];

export const OTHER_DETAILING_SOFTWARE = [
  'sds/2',
  'sds2',
  'strumis',
  'bocad',
  'tecnometal',
  'stad',
  'staad',
  'prosteel',
  'solidworks',
  'inventor',
  'autocad',
];

/** Vertical → base industry-fit points and the human-readable ICP tier name. */
export const VERTICAL_FIT: Record<Vertical, { points: number; segment: string }> = {
  steel: { points: 20, segment: 'Tier 1 - Metal and Steel Fabrication' },
  peb: { points: 20, segment: 'Tier 1 - Pre-Engineered Buildings' },
  aluminium: { points: 17, segment: 'Tier 1 - Aluminium Fabrication' },
  precast: { points: 16, segment: 'Tier 2 - Precast Manufacturing' },
  job_shop: { points: 14, segment: 'Tier 2 - Industrial Job Shop' },
  modular: { points: 12, segment: 'Tier 3 - Modular Manufacturing' },
  joinery: { points: 9, segment: 'Tier 3 - Joinery and Woodworking' },
  other: { points: 3, segment: 'Tier 4 - Other Manufacturing' },
};

/** Core markets get full geography credit; adjacent markets get partial. */
export const CORE_COUNTRIES = [
  'Egypt',
  'Saudi Arabia',
  'United Arab Emirates',
  'Qatar',
  'Kuwait',
  'Oman',
  'Bahrain',
];

export const ADJACENT_COUNTRIES = ['Jordan', 'Iraq', 'Libya', 'Morocco', 'Tunisia', 'Algeria'];

/** Sweet spot is a shop big enough to hurt but small enough to decide fast. */
export const EMPLOYEE_SWEET_SPOT = { min: 20, max: 250 };

export const SEGMENT_THRESHOLDS: { min: number; segment: PrioritySegment; action: string }[] = [
  { min: 80, segment: 'A', action: 'Immediate personalised outreach' },
  { min: 65, segment: 'B', action: 'Sales development outreach' },
  { min: 50, segment: 'C', action: 'Research further or use marketing' },
  { min: 0, segment: 'D', action: 'Do not contact automatically' },
];

/**
 * Below this confidence a lead never lands in the sheet as qualified, however
 * good the fit score looks — it goes to the human review queue instead.
 */
export const MIN_CONFIDENCE_FOR_AUTO_QUALIFY = 55;

/**
 * ...but only if it could plausibly qualify once the missing evidence turns up.
 * A low-confidence lead scoring below this is rejected rather than queued, so
 * the review queue stays a list of real maybes instead of everything the
 * enrichment step failed to read.
 */
export const REVIEW_SCORE_FLOOR = 40;

/**
 * A fact set with no evidence at all is unverifiable by construction, however
 * confident the model sounded. Cap it below the auto-qualify bar so it can only
 * ever reach the review queue — never the outreach sheet.
 */
export const NO_EVIDENCE_CONFIDENCE_CAP = 40;

export const CAPACITY_BANDS: { band: CapacityBand; min: number; max: number; label: string }[] = [
  { band: 'micro', min: 0, max: 99, label: '<100 t/month' },
  { band: 'small', min: 100, max: 399, label: '100-399 t/month' },
  { band: 'mid', min: 400, max: 999, label: '400-999 t/month' },
  { band: 'large', min: 1000, max: Number.POSITIVE_INFINITY, label: '1000+ t/month' },
];

export function segmentForScore(score: number): { segment: PrioritySegment; action: string } {
  for (const t of SEGMENT_THRESHOLDS) {
    if (score >= t.min) return { segment: t.segment, action: t.action };
  }
  return { segment: 'D', action: 'Do not contact automatically' };
}

export function capacityBandFor(tpm: number | null): CapacityBand {
  if (tpm === null || !Number.isFinite(tpm) || tpm <= 0) return 'unknown';
  for (const b of CAPACITY_BANDS) {
    if (tpm >= b.min && tpm <= b.max) return b.band;
  }
  return 'unknown';
}

export function capacityBandLabel(band: CapacityBand): string {
  if (band === 'unknown') return 'Capacity unknown';
  return CAPACITY_BANDS.find((b) => b.band === band)?.label ?? 'Capacity unknown';
}
