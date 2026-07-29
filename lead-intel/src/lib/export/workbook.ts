/**
 * Builds the export dataset. Shared by the .xlsx exporter and the Google Sheets
 * sync so the two can never disagree about what a column means.
 *
 * The database is the source of truth. Everything here is a read-only view of
 * it — which is why the workbook carries a "do not edit" banner and the sync is
 * a full replace.
 */

import type { Contact, Evidence, Lead, Run } from '../types.js';
import type { LeadStore } from '../store/index.js';
import { groupIntoSegments, segmentTabName, type SegmentSummary } from '../icp/segments.js';
import { personaLabel } from '../icp/personas.js';
import { capacityBandLabel } from '../icp/rubric.js';

export interface SheetTable {
  name: string;
  columns: { key: string; header: string; width: number }[];
  rows: (string | number | null)[][];
  /** Freeze the header row and add an autofilter. */
  freezeHeader: boolean;
}

export interface WorkbookData {
  generatedAt: string;
  sheets: SheetTable[];
  segments: SegmentSummary[];
  stats: {
    total: number;
    qualified: number;
    nurture: number;
    review: number;
    rejected: number;
    contacts: number;
    newThisWeek: number;
  };
}

const LEAD_COLUMNS = [
  { key: 'lead_ref', header: 'Lead ID', width: 20 },
  { key: 'company_name', header: 'Company Name', width: 38 },
  { key: 'website', header: 'Website', width: 34 },
  { key: 'country', header: 'Country', width: 16 },
  { key: 'city', header: 'City', width: 16 },
  { key: 'industry', header: 'Industry', width: 22 },
  { key: 'icp_segment', header: 'ICP Segment', width: 34 },
  { key: 'employee_range', header: 'Employee Range', width: 15 },
  { key: 'fit_score', header: 'Fit Score', width: 10 },
  { key: 'confidence', header: 'Confidence', width: 11 },
  { key: 'priority_segment', header: 'Priority Segment', width: 15 },
  { key: 'qualification_status', header: 'Qualification Status', width: 18 },
  { key: 'qualification_reason', header: 'Qualification Reason', width: 60 },
  { key: 'pain_signals', header: 'Pain Signals', width: 50 },
  { key: 'outreach_angle', header: 'Recommended Outreach Angle', width: 50 },
  { key: 'detailing_software', header: 'Detailing Software', width: 24 },
  { key: 'capacity_band', header: 'Capacity Band', width: 18 },
  { key: 'segment_key', header: 'Segment Key', width: 34 },
  { key: 'source', header: 'Source', width: 16 },
  { key: 'source_url', header: 'Source URL', width: 40 },
  { key: 'first_seen_at', header: 'First Generated Date', width: 20 },
  { key: 'last_seen_at', header: 'Last Checked Date', width: 20 },
  { key: 'latest_run_id', header: 'Run ID', width: 38 },
  { key: 'previous_score', header: 'Previous Score', width: 13 },
  { key: 'score_delta', header: 'Score Change', width: 12 },
  { key: 'changed_fields', header: 'Changed Fields', width: 30 },
  { key: 'crm_status', header: 'CRM Status', width: 14 },
  { key: 'assigned_to', header: 'Assigned Salesperson', width: 22 },
  { key: 'notes', header: 'Notes', width: 40 },
];

function joinList(values: string[] | null | undefined, limit = 6): string | null {
  if (!values || values.length === 0) return null;
  const shown = values.slice(0, limit).join('; ');
  return values.length > limit ? `${shown}; (+${values.length - limit} more)` : shown;
}

function isoDate(value: string | null): string | null {
  return value ? value.slice(0, 10) : null;
}

function leadRow(lead: Lead): (string | number | null)[] {
  const delta =
    lead.previous_score !== null && lead.current_score !== null
      ? lead.current_score - lead.previous_score
      : null;

  return [
    lead.lead_ref,
    lead.company_name,
    lead.website,
    lead.country,
    lead.city,
    lead.industry,
    lead.icp_segment,
    lead.employee_range,
    lead.fit_score,
    lead.confidence,
    lead.priority_segment,
    lead.qualification_status,
    lead.qualification_reason,
    joinList(lead.pain_signals),
    lead.outreach_angle,
    joinList(lead.detailing_software),
    capacityBandLabel(lead.capacity_band),
    lead.segment_key,
    lead.source,
    lead.source_url,
    isoDate(lead.first_seen_at),
    isoDate(lead.last_seen_at),
    lead.latest_run_id,
    lead.previous_score,
    delta,
    joinList(lead.changed_fields, 8),
    lead.crm_status,
    lead.assigned_to,
    lead.notes,
  ];
}

export interface BuildWorkbookOptions {
  /** Leads first seen on or after this ISO date land in the "New This Week" tab. */
  newSince?: string;
  /** Emit one tab per derived segment. */
  includeSegmentTabs?: boolean;
}

export async function buildWorkbookData(
  store: LeadStore,
  options: BuildWorkbookOptions = {},
): Promise<WorkbookData> {
  const newSince =
    options.newSince ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const allLeads = await store.listLeads();
  const contacts = await store.listContacts();
  const evidence = await store.listEvidence();
  const runs = await store.listRuns(200);

  const qualified = allLeads.filter((l) => l.qualification_status === 'qualified');
  const nurture = allLeads.filter((l) => l.qualification_status === 'nurture');
  const review = allLeads.filter((l) => l.qualification_status === 'review');
  const rejected = allLeads.filter((l) => l.qualification_status === 'rejected');

  // Segment tabs cover everything worth acting on, so nurture is included.
  const actionable = [...qualified, ...nurture];
  const segments = groupIntoSegments(actionable);

  const leadById = new Map(allLeads.map((l) => [l.id, l]));

  const sheets: SheetTable[] = [
    {
      name: 'Qualified Leads',
      columns: LEAD_COLUMNS,
      rows: qualified.map(leadRow),
      freezeHeader: true,
    },
    {
      name: 'Contacts',
      columns: [
        { key: 'contact_ref', header: 'Contact ID', width: 20 },
        { key: 'lead_ref', header: 'Lead ID', width: 20 },
        { key: 'company_name', header: 'Company', width: 34 },
        { key: 'full_name', header: 'Full Name', width: 26 },
        { key: 'job_title', header: 'Job Title', width: 30 },
        { key: 'persona_type', header: 'Persona Type', width: 22 },
        { key: 'email', header: 'Email', width: 32 },
        { key: 'email_status', header: 'Email Verification Status', width: 22 },
        { key: 'phone', header: 'Phone', width: 20 },
        { key: 'profile_url', header: 'Profile URL', width: 38 },
        { key: 'seniority', header: 'Seniority', width: 16 },
        { key: 'contact_score', header: 'Contact Score', width: 13 },
        { key: 'source', header: 'Source', width: 14 },
        { key: 'last_seen_at', header: 'Last Checked Date', width: 20 },
      ],
      rows: contactRows(contacts, leadById),
      freezeHeader: true,
    },
    {
      name: 'Evidence',
      columns: [
        { key: 'lead_ref', header: 'Lead ID', width: 20 },
        { key: 'company_name', header: 'Company', width: 34 },
        { key: 'evidence_type', header: 'Evidence Type', width: 28 },
        { key: 'finding', header: 'Finding', width: 70 },
        { key: 'source_url', header: 'Source URL', width: 46 },
        { key: 'collected_at', header: 'Collected Date', width: 18 },
        { key: 'ai_confidence', header: 'AI Confidence', width: 14 },
      ],
      rows: evidenceRows(evidence, leadById),
      freezeHeader: true,
    },
    {
      name: 'Review Queue',
      columns: [
        { key: 'lead_ref', header: 'Lead ID', width: 20 },
        { key: 'company_name', header: 'Company', width: 34 },
        { key: 'website', header: 'Website', width: 34 },
        { key: 'country', header: 'Country', width: 16 },
        { key: 'fit_score', header: 'Fit Score', width: 10 },
        { key: 'confidence', header: 'Confidence', width: 11 },
        { key: 'reason', header: 'Why It Needs Review', width: 70 },
        { key: 'first_seen_at', header: 'First Generated Date', width: 20 },
      ],
      rows: review.map((l) => [
        l.lead_ref,
        l.company_name,
        l.website,
        l.country,
        l.fit_score,
        l.confidence,
        l.qualification_reason,
        isoDate(l.first_seen_at),
      ]),
      freezeHeader: true,
    },
    {
      name: 'Rejected Leads',
      columns: [
        { key: 'lead_ref', header: 'Lead ID', width: 20 },
        { key: 'company_name', header: 'Company', width: 34 },
        { key: 'website', header: 'Website', width: 34 },
        { key: 'country', header: 'Country', width: 16 },
        { key: 'fit_score', header: 'Fit Score', width: 10 },
        { key: 'rejection_reasons', header: 'Rejection Reason', width: 60 },
        { key: 'source', header: 'Source', width: 16 },
        { key: 'last_seen_at', header: 'Last Checked Date', width: 20 },
      ],
      rows: rejected.map((l) => [
        l.lead_ref,
        l.company_name,
        l.website,
        l.country,
        l.fit_score,
        joinList(l.rejection_reasons, 5),
        l.source,
        isoDate(l.last_seen_at),
      ]),
      freezeHeader: true,
    },
    {
      name: 'Generation Runs',
      columns: [
        { key: 'run_ref', header: 'Run ID', width: 22 },
        { key: 'campaign_name', header: 'Campaign Name', width: 30 },
        { key: 'criteria', header: 'Search Criteria', width: 70 },
        { key: 'started_at', header: 'Started Date', width: 20 },
        { key: 'companies_found', header: 'Companies Found', width: 16 },
        { key: 'companies_qualified', header: 'Companies Qualified', width: 18 },
        { key: 'contacts_found', header: 'Contacts Found', width: 15 },
        { key: 'duplicates_removed', header: 'Duplicates Removed', width: 18 },
        { key: 'rejected', header: 'Rejected', width: 11 },
        { key: 'sent_to_review', header: 'Sent To Review', width: 15 },
        { key: 'status', header: 'Status', width: 12 },
        { key: 'export_filename', header: 'Export Filename', width: 36 },
      ],
      rows: runs.map(runRow),
      freezeHeader: true,
    },
    {
      name: 'New This Week',
      columns: LEAD_COLUMNS,
      rows: actionable.filter((l) => l.first_seen_at >= newSince).map(leadRow),
      freezeHeader: true,
    },
    {
      name: 'Score Movement',
      columns: [
        { key: 'lead_ref', header: 'Lead ID', width: 20 },
        { key: 'company_name', header: 'Company', width: 34 },
        { key: 'previous_score', header: 'Previous Score', width: 14 },
        { key: 'current_score', header: 'Current Score', width: 13 },
        { key: 'delta', header: 'Change', width: 10 },
        { key: 'changed_fields', header: 'Changed Fields', width: 40 },
        { key: 'last_seen_at', header: 'Last Checked Date', width: 20 },
      ],
      rows: allLeads
        .filter((l) => l.previous_score !== null && l.current_score !== null && l.previous_score !== l.current_score)
        .sort(
          (a, b) =>
            (b.current_score! - b.previous_score!) - (a.current_score! - a.previous_score!),
        )
        .map((l) => [
          l.lead_ref,
          l.company_name,
          l.previous_score,
          l.current_score,
          l.current_score! - l.previous_score!,
          joinList(l.changed_fields, 8),
          isoDate(l.last_seen_at),
        ]),
      freezeHeader: true,
    },
  ];

  if (options.includeSegmentTabs !== false) {
    sheets.push(...segmentSheets(segments));
  }

  return {
    generatedAt: new Date().toISOString(),
    sheets,
    segments,
    stats: {
      total: allLeads.length,
      qualified: qualified.length,
      nurture: nurture.length,
      review: review.length,
      rejected: rejected.length,
      contacts: contacts.length,
      newThisWeek: actionable.filter((l) => l.first_seen_at >= newSince).length,
    },
  };
}

function contactRows(
  contacts: Contact[],
  leadById: Map<string, Lead>,
): (string | number | null)[][] {
  return contacts
    .slice()
    .sort((a, b) => b.contact_score - a.contact_score)
    .map((c) => {
      const lead = leadById.get(c.lead_id);
      return [
        c.contact_ref,
        lead?.lead_ref ?? c.lead_id,
        lead?.company_name ?? null,
        c.full_name,
        c.job_title,
        personaLabel(c.persona_type),
        c.email,
        c.email_status,
        c.phone,
        c.profile_url,
        c.seniority,
        c.contact_score,
        c.source,
        isoDate(c.last_seen_at),
      ];
    });
}

function evidenceRows(
  evidence: Evidence[],
  leadById: Map<string, Lead>,
): (string | number | null)[][] {
  return evidence.map((e) => {
    const lead = leadById.get(e.lead_id);
    return [
      lead?.lead_ref ?? e.lead_id,
      lead?.company_name ?? null,
      e.evidence_type,
      e.finding,
      e.source_url,
      isoDate(e.collected_at),
      e.ai_confidence,
    ];
  });
}

function runRow(run: Run): (string | number | null)[] {
  const c = run.criteria;
  const criteriaSummary = [
    c.countries.length ? `Countries: ${c.countries.join(', ')}` : null,
    c.queries.length ? `Queries: ${c.queries.join(', ')}` : null,
    c.verticals.length ? `Verticals: ${c.verticals.join(', ')}` : null,
    c.employees_min !== null || c.employees_max !== null
      ? `Employees: ${c.employees_min ?? 0}-${c.employees_max ?? '∞'}`
      : null,
    c.exclude.length ? `Exclude: ${c.exclude.join(', ')}` : null,
    `Target: ${c.target_accounts}`,
  ]
    .filter(Boolean)
    .join(' | ');

  return [
    run.run_ref,
    run.campaign_name,
    criteriaSummary,
    run.started_at.slice(0, 19).replace('T', ' '),
    run.companies_found,
    run.companies_qualified,
    run.contacts_found,
    run.duplicates_removed,
    run.rejected,
    run.sent_to_review,
    run.status,
    run.export_filename,
  ];
}

/** One tab per derived segment, with Excel's 31-char name limit enforced. */
function segmentSheets(segments: SegmentSummary[]): SheetTable[] {
  const used = new Set<string>();
  const sheets: SheetTable[] = [];

  for (const segment of segments) {
    if (segment.count === 0) continue;

    let name = segmentTabName(segment.parts);
    if (used.has(name)) {
      let suffix = 2;
      const base = name.slice(0, 28);
      while (used.has(`${base}~${suffix}`)) suffix += 1;
      name = `${base}~${suffix}`;
    }
    used.add(name);

    sheets.push({
      name,
      columns: LEAD_COLUMNS,
      rows: segment.leads.map(leadRow),
      freezeHeader: true,
    });
  }

  return sheets;
}

export { LEAD_COLUMNS };
