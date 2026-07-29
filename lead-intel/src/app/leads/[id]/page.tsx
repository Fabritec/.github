import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getStore } from '@/lib/store';
import { personaLabel } from '@/lib/icp/personas';
import { capacityBandLabel } from '@/lib/icp/rubric';
import { ScoreBar, Tier } from '../../components';
import { LeadActions } from './actions';

export const dynamic = 'force-dynamic';

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const store = await getStore();
  const lead = await store.getLead(id);
  if (!lead) notFound();

  const contacts = await store.listContacts([lead.id]);
  const evidence = await store.listEvidence([lead.id]);
  const facts = lead.facts;

  return (
    <>
      <p className="small">
        <Link href="/leads">← Back to leads</Link>
      </p>
      <h1>{lead.company_name}</h1>
      <p className="subtitle">
        {lead.lead_ref} · {[lead.city, lead.country].filter(Boolean).join(', ') || 'Location unknown'}
        {lead.website ? (
          <>
            {' · '}
            <a href={lead.website} target="_blank" rel="noreferrer noopener">
              {lead.domain ?? lead.website}
            </a>
          </>
        ) : null}
      </p>

      {lead.qualification_status === 'review' && (
        <div className="note">
          This lead is in the review queue: the score looks workable but the evidence behind it is
          thin. Confirm it before anyone calls.
        </div>
      )}

      <div className="cards">
        <div className="card">
          <div className="label">Fit score</div>
          <div style={{ marginTop: 8 }}>
            <ScoreBar score={lead.fit_score} />
          </div>
        </div>
        <div className="card">
          <div className="label">Confidence</div>
          <div style={{ marginTop: 8 }}>
            <ScoreBar score={lead.confidence} />
          </div>
        </div>
        <div className="card">
          <div className="label">Tier</div>
          <div className="value">
            <Tier segment={lead.priority_segment} />
          </div>
        </div>
        <div className="card">
          <div className="label">Status</div>
          <div className="value" style={{ fontSize: 18 }}>
            {lead.qualification_status}
          </div>
        </div>
      </div>

      <div className="two-col" style={{ marginTop: 26 }}>
        <div>
          <h2 style={{ marginTop: 0 }}>Why it scored this way</h2>
          {lead.score_breakdown && lead.score_breakdown.length > 0 ? (
            <div className="panel" style={{ padding: '14px 16px' }}>
              <div className="breakdown">
                {lead.score_breakdown.map((line) => (
                  <div key={line.factor} className="breakdown-row">
                    <div>
                      <div>{line.label}</div>
                      <div className="muted small">{line.why}</div>
                    </div>
                    <div className="nowrap">
                      <strong>{line.points}</strong>
                      <span className="muted small">/{line.max}</span>
                    </div>
                    <div className="bar">
                      <span
                        style={{
                          width: `${line.max > 0 ? (line.points / line.max) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="panel">
              <div className="empty">
                Not scored — {lead.qualification_reason ?? 'rejected before scoring'}.
              </div>
            </div>
          )}

          <h2>Evidence</h2>
          {evidence.length === 0 ? (
            <div className="panel">
              <div className="empty">No evidence recorded.</div>
            </div>
          ) : (
            <div className="panel" style={{ padding: '16px 18px' }}>
              {evidence.map((item) => (
                <div key={item.id} className="evidence">
                  <div className="muted small">
                    {item.evidence_type} · confidence {item.ai_confidence}
                  </div>
                  <div>{item.finding}</div>
                  {item.source_url && (
                    <div className="small">
                      <a href={item.source_url} target="_blank" rel="noreferrer noopener">
                        {item.source_url}
                      </a>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <h2>Contacts</h2>
          {contacts.length === 0 ? (
            <div className="panel">
              <div className="empty">
                No contacts resolved. Contacts are only looked up for companies that pass scoring.
              </div>
            </div>
          ) : (
            <div className="panel table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Title</th>
                    <th>Persona</th>
                    <th>Email</th>
                    <th>Verified</th>
                    <th>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((contact) => (
                    <tr key={contact.id}>
                      <td>
                        <strong>{contact.full_name}</strong>
                      </td>
                      <td className="small">{contact.job_title ?? '—'}</td>
                      <td className="small">{personaLabel(contact.persona_type)}</td>
                      <td className="small">{contact.email ?? '—'}</td>
                      <td>
                        <span className="pill">{contact.email_status}</span>
                      </td>
                      <td>{contact.contact_score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          <h2 style={{ marginTop: 0 }}>Qualification</h2>
          <div className="panel" style={{ padding: '14px 16px' }}>
            <dl className="kv">
              <dt>ICP segment</dt>
              <dd>{lead.icp_segment ?? '—'}</dd>
              <dt>Derived segment</dt>
              <dd className="small">{lead.segment_key ?? '—'}</dd>
              <dt>Vertical</dt>
              <dd>{lead.vertical ?? '—'}</dd>
              <dt>Production model</dt>
              <dd>{lead.manufacturing_model ?? '—'}</dd>
              <dt>Capacity</dt>
              <dd>{capacityBandLabel(lead.capacity_band)}</dd>
              <dt>Headcount</dt>
              <dd>{lead.employee_range ?? '—'}</dd>
              <dt>Detailing software</dt>
              <dd>{lead.detailing_software.join(', ') || '—'}</dd>
              <dt>Source</dt>
              <dd>{lead.source}</dd>
              <dt>First seen</dt>
              <dd>{lead.first_seen_at.slice(0, 10)}</dd>
              <dt>Last checked</dt>
              <dd>{lead.last_seen_at.slice(0, 10)}</dd>
              <dt>Score history</dt>
              <dd>
                {lead.previous_score !== null
                  ? `${lead.previous_score} → ${lead.current_score ?? '—'}`
                  : 'First scoring'}
              </dd>
              {lead.changed_fields.length > 0 && (
                <>
                  <dt>Changed last run</dt>
                  <dd className="small">{lead.changed_fields.join(', ')}</dd>
                </>
              )}
            </dl>
          </div>

          {lead.outreach_angle && (
            <>
              <h2>Outreach angle</h2>
              <div className="panel" style={{ padding: '14px 16px' }}>
                {lead.outreach_angle}
              </div>
            </>
          )}

          {lead.pain_signals.length > 0 && (
            <>
              <h2>Pain signals</h2>
              <div className="panel" style={{ padding: '14px 16px' }}>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {lead.pain_signals.map((signal) => (
                    <li key={signal}>{signal}</li>
                  ))}
                </ul>
              </div>
            </>
          )}

          {lead.rejection_reasons.length > 0 && (
            <>
              <h2>Rejection reasons</h2>
              <div className="panel" style={{ padding: '14px 16px' }}>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {lead.rejection_reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
            </>
          )}

          <h2>Update</h2>
          <LeadActions
            leadId={lead.id}
            crmStatus={lead.crm_status}
            assignedTo={lead.assigned_to}
            notes={lead.notes}
            status={lead.qualification_status}
          />

          {facts?.reasoning && (
            <>
              <h2>Analyst notes</h2>
              <div className="panel small muted" style={{ padding: '14px 16px' }}>
                {facts.reasoning}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
