/**
 * The contract between the model and the rest of the system.
 *
 * `companyFactsSchema` is both the runtime validator and the source of the tool
 * schema handed to the model, so the two can't drift.
 */

import { z } from 'zod';
import type { CompanyFacts } from '../types.js';

export const verticalEnum = z.enum([
  'steel',
  'aluminium',
  'precast',
  'peb',
  'modular',
  'joinery',
  'job_shop',
  'other',
]);

export const evidenceItemSchema = z.object({
  claim: z.string().describe('Which qualification factor this supports'),
  finding: z.string().describe('What the source actually says, in one sentence'),
  source_url: z.string().nullable().describe('URL the finding came from, or null'),
  strength: z.enum(['strong', 'moderate', 'weak']),
});

export const companyFactsSchema = z.object({
  vertical: verticalEnum,
  is_manufacturer: z
    .boolean()
    .describe('True only with evidence of in-house production, not just supply or installation'),
  business_model: z.enum([
    'manufacturer',
    'trader_distributor',
    'contractor_only',
    'service_provider',
    'unknown',
  ]),
  manufacturing_model: z.enum([
    'project_based',
    'job_shop',
    'make_to_order',
    'repetitive_mass',
    'unknown',
  ]),
  uses_drawings_boms_revisions: z.boolean(),
  multi_stage_production: z.boolean(),
  production_stages: z
    .array(z.string())
    .describe('Named stages, e.g. cutting, fit-up, welding, blasting, painting, dispatch'),
  has_qc_process: z.boolean(),
  handles_shipping: z.boolean(),
  handles_installation: z.boolean(),
  detailing_software: z
    .array(z.string())
    .describe('Named CAD/detailing/ERP software, e.g. Tekla Structures, Advance Steel, SDS/2'),
  certifications: z.array(z.string()).describe('e.g. AISC, ISO 9001, EN 1090, CE'),
  estimated_capacity_tpm: z
    .number()
    .nullable()
    .describe('Production capacity in tonnes per month, null if not stated'),
  plants: z.number().nullable().describe('Number of production facilities, null if not stated'),
  employee_estimate: z.number().nullable(),
  countries_of_operation: z.array(z.string()),
  manual_tracking_signals: z
    .array(z.string())
    .describe('Evidence of spreadsheet/manual/whiteboard production tracking'),
  named_projects: z.array(z.string()).describe('Specific projects named in a portfolio'),
  pain_signals: z.array(z.string()),
  outreach_angle: z.string().describe('One sentence: the most relevant hook for this company'),
  disqualifiers: z
    .array(z.string())
    .describe('Concrete reasons this company is not a fit, empty if none'),
  evidence: z.array(evidenceItemSchema),
  confidence: z.enum(['high', 'medium', 'low']),
  reasoning: z.string(),
});

export type ParsedCompanyFacts = z.infer<typeof companyFactsSchema>;

/**
 * JSON Schema for the model-facing tool definition. Hand-written rather than
 * generated so the descriptions stay tuned for the model rather than for TS.
 */
export const COMPANY_FACTS_TOOL_SCHEMA = {
  type: 'object' as const,
  properties: {
    vertical: {
      type: 'string',
      enum: verticalEnum.options,
      description: 'Primary manufacturing vertical. Use "other" if none apply.',
    },
    is_manufacturer: {
      type: 'boolean',
      description:
        'True ONLY if there is evidence of in-house production (workshop, plant, machinery, fabrication capability). Supplying or installing someone else\'s product is not manufacturing.',
    },
    business_model: {
      type: 'string',
      enum: ['manufacturer', 'trader_distributor', 'contractor_only', 'service_provider', 'unknown'],
    },
    manufacturing_model: {
      type: 'string',
      enum: ['project_based', 'job_shop', 'make_to_order', 'repetitive_mass', 'unknown'],
      description:
        'project_based = discrete named projects with drawings and delivery dates; job_shop = varied custom orders; make_to_order = configured standard products; repetitive_mass = same product continuously.',
    },
    uses_drawings_boms_revisions: {
      type: 'boolean',
      description: 'Evidence that production is driven by drawings, bills of materials or revisions.',
    },
    multi_stage_production: { type: 'boolean' },
    production_stages: { type: 'array', items: { type: 'string' } },
    has_qc_process: { type: 'boolean' },
    handles_shipping: { type: 'boolean' },
    handles_installation: { type: 'boolean' },
    detailing_software: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Named CAD/detailing/ERP software. Record exactly as written, e.g. "Tekla Structures", "Advance Steel", "SDS/2", "StruMIS".',
    },
    certifications: { type: 'array', items: { type: 'string' } },
    estimated_capacity_tpm: {
      type: ['number', 'null'],
      description: 'Tonnes per month. Convert from annual if only that is stated. null if unknown.',
    },
    plants: { type: ['number', 'null'] },
    employee_estimate: { type: ['number', 'null'] },
    countries_of_operation: { type: 'array', items: { type: 'string' } },
    manual_tracking_signals: { type: 'array', items: { type: 'string' } },
    named_projects: { type: 'array', items: { type: 'string' } },
    pain_signals: { type: 'array', items: { type: 'string' } },
    outreach_angle: { type: 'string' },
    disqualifiers: { type: 'array', items: { type: 'string' } },
    evidence: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          claim: { type: 'string' },
          finding: { type: 'string' },
          source_url: { type: ['string', 'null'] },
          strength: { type: 'string', enum: ['strong', 'moderate', 'weak'] },
        },
        required: ['claim', 'finding', 'source_url', 'strength'],
      },
    },
    confidence: {
      type: 'string',
      enum: ['high', 'medium', 'low'],
      description:
        'How much of this is grounded in the supplied text. Use "low" when you are mostly inferring from the company name or a thin page.',
    },
    reasoning: { type: 'string' },
  },
  required: [
    'vertical',
    'is_manufacturer',
    'business_model',
    'manufacturing_model',
    'uses_drawings_boms_revisions',
    'multi_stage_production',
    'production_stages',
    'has_qc_process',
    'handles_shipping',
    'handles_installation',
    'detailing_software',
    'certifications',
    'estimated_capacity_tpm',
    'plants',
    'employee_estimate',
    'countries_of_operation',
    'manual_tracking_signals',
    'named_projects',
    'pain_signals',
    'outreach_angle',
    'disqualifiers',
    'evidence',
    'confidence',
    'reasoning',
  ],
};

/** A conservative all-unknown fact set, used when enrichment can't run. */
export function emptyFacts(reason: string): CompanyFacts {
  return {
    vertical: 'other',
    is_manufacturer: false,
    business_model: 'unknown',
    manufacturing_model: 'unknown',
    uses_drawings_boms_revisions: false,
    multi_stage_production: false,
    production_stages: [],
    has_qc_process: false,
    handles_shipping: false,
    handles_installation: false,
    detailing_software: [],
    certifications: [],
    estimated_capacity_tpm: null,
    plants: null,
    employee_estimate: null,
    countries_of_operation: [],
    manual_tracking_signals: [],
    named_projects: [],
    pain_signals: [],
    outreach_angle: '',
    disqualifiers: [],
    evidence: [],
    confidence: 'low',
    reasoning: reason,
  };
}
