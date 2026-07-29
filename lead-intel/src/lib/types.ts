/**
 * Domain types shared by the pipeline, the store adapters, the UI and the exporters.
 *
 * The rule this file encodes: the AI layer only ever produces `CompanyFacts`.
 * Scores, segments and qualification statuses are derived from those facts in
 * code (see `src/lib/icp/`), never asked for in a prompt.
 */

export type Vertical =
  | 'steel'
  | 'aluminium'
  | 'precast'
  | 'peb'
  | 'modular'
  | 'joinery'
  | 'job_shop'
  | 'other';

export type BusinessModel =
  | 'manufacturer'
  | 'trader_distributor'
  | 'contractor_only'
  | 'service_provider'
  | 'unknown';

export type ManufacturingModel =
  | 'project_based'
  | 'job_shop'
  | 'make_to_order'
  | 'repetitive_mass'
  | 'unknown';

export type AiConfidence = 'high' | 'medium' | 'low';

export type EvidenceStrength = 'strong' | 'moderate' | 'weak';

export type QualificationStatus =
  | 'qualified'
  | 'nurture'
  | 'rejected'
  | 'review'
  | 'pending';

/** A = priority, B = qualified, C = nurture, D = reject. */
export type PrioritySegment = 'A' | 'B' | 'C' | 'D';

export type CapacityBand = 'unknown' | 'micro' | 'small' | 'mid' | 'large';

export type PersonaType =
  | 'economic_buyer'
  | 'operational_champion'
  | 'technical_influencer'
  | 'alternate'
  | 'unknown';

export type EmailStatus =
  | 'verified'
  | 'accept_all'
  | 'unverified'
  | 'invalid'
  | 'unknown';

export type SourceName =
  | 'google_places'
  | 'apollo'
  | 'hunter'
  | 'website'
  | 'directory_import'
  | 'exhibitor_import'
  | 'manual_import'
  | 'fixture';

/** One evidence item extracted by the AI layer, with its provenance. */
export interface EvidenceItem {
  claim: string;
  finding: string;
  source_url: string | null;
  strength: EvidenceStrength;
}

/**
 * Structured facts returned by the model. Deliberately factual: no scores, no
 * tiers, no "is this a good lead" judgement.
 */
export interface CompanyFacts {
  vertical: Vertical;
  is_manufacturer: boolean;
  business_model: BusinessModel;
  manufacturing_model: ManufacturingModel;
  uses_drawings_boms_revisions: boolean;
  multi_stage_production: boolean;
  production_stages: string[];
  has_qc_process: boolean;
  handles_shipping: boolean;
  handles_installation: boolean;
  detailing_software: string[];
  certifications: string[];
  estimated_capacity_tpm: number | null;
  plants: number | null;
  employee_estimate: number | null;
  countries_of_operation: string[];
  manual_tracking_signals: string[];
  named_projects: string[];
  pain_signals: string[];
  outreach_angle: string;
  disqualifiers: string[];
  evidence: EvidenceItem[];
  confidence: AiConfidence;
  reasoning: string;
}

/** A single line of the score breakdown, kept so every number is auditable. */
export interface ScoreLine {
  factor: string;
  label: string;
  points: number;
  max: number;
  why: string;
}

export interface ScoreResult {
  fit_score: number;
  confidence: number;
  breakdown: ScoreLine[];
  bonuses: ScoreLine[];
  priority_segment: PrioritySegment;
  qualification_status: QualificationStatus;
  qualification_reason: string;
  rejection_reasons: string[];
}

/** Raw company shell produced by a discovery source, before enrichment. */
export interface DiscoveredCompany {
  name: string;
  website: string | null;
  domain: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  source: SourceName;
  source_url: string | null;
  provider_company_id: string | null;
  /** Anything source-specific worth keeping for debugging or later re-scoring. */
  raw: Record<string, unknown>;
}

export interface Lead {
  id: string;
  lead_ref: string;
  company_name: string;
  website: string | null;
  domain: string | null;
  country: string | null;
  city: string | null;
  address: string | null;
  phone: string | null;
  industry: string | null;
  vertical: Vertical | null;
  icp_segment: string | null;
  segment_key: string | null;
  capacity_band: CapacityBand;
  employee_range: string | null;
  manufacturing_model: ManufacturingModel | null;
  fit_score: number | null;
  confidence: number | null;
  priority_segment: PrioritySegment | null;
  qualification_status: QualificationStatus;
  qualification_reason: string | null;
  pain_signals: string[];
  outreach_angle: string | null;
  rejection_reasons: string[];
  detailing_software: string[];
  source: SourceName;
  source_url: string | null;
  provider_company_id: string | null;
  first_seen_at: string;
  last_seen_at: string;
  last_enriched_at: string | null;
  original_run_id: string;
  latest_run_id: string;
  previous_score: number | null;
  current_score: number | null;
  changed_fields: string[];
  crm_status: string;
  assigned_to: string | null;
  notes: string | null;
  facts: CompanyFacts | null;
  score_breakdown: ScoreLine[] | null;
}

export interface Contact {
  id: string;
  contact_ref: string;
  lead_id: string;
  full_name: string;
  job_title: string | null;
  persona_type: PersonaType;
  email: string | null;
  email_status: EmailStatus;
  phone: string | null;
  profile_url: string | null;
  seniority: string | null;
  contact_score: number;
  source: SourceName;
  provider_person_id: string | null;
  /** Denormalised `normalised name::company domain` for the third dedupe rule. */
  name_domain_key: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

export interface Evidence {
  id: string;
  lead_id: string;
  evidence_type: string;
  finding: string;
  source_url: string | null;
  collected_at: string;
  ai_confidence: AiConfidence;
}

export type RunStatus = 'running' | 'completed' | 'failed';

export interface Run {
  id: string;
  run_ref: string;
  campaign_name: string;
  criteria: CampaignCriteria;
  started_at: string;
  finished_at: string | null;
  status: RunStatus;
  companies_found: number;
  companies_qualified: number;
  contacts_found: number;
  duplicates_removed: number;
  rejected: number;
  sent_to_review: number;
  export_filename: string | null;
  error: string | null;
}

export interface CampaignCriteria {
  campaign_name: string;
  countries: string[];
  cities: string[];
  /** Free-text search phrases fed to the discovery sources. */
  queries: string[];
  verticals: Vertical[];
  employees_min: number | null;
  employees_max: number | null;
  target_roles: string[];
  exclude: string[];
  target_accounts: number;
  /** Discovery sources to use for this run, in order. */
  sources: SourceName[];
  /** Skip live API calls and use bundled fixtures. */
  dry_run: boolean;
  /** Max contacts to resolve per qualified company. */
  contacts_per_company: number;
}

export interface LeadDelta {
  lead: Lead;
  is_new: boolean;
  changed_fields: string[];
  previous_score: number | null;
}
