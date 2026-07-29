/** Small presentational pieces shared across pages. */

import Link from 'next/link';
import type { Lead, PrioritySegment } from '@/lib/types';

export function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}

export function Tier({ segment }: { segment: PrioritySegment | null }) {
  if (!segment) return <span className="muted">—</span>;
  return <span className={`tier tier-${segment}`}>{segment}</span>;
}

export function ScoreBar({ score }: { score: number | null }) {
  if (score === null) return <span className="muted">—</span>;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <strong style={{ minWidth: 24 }}>{score}</strong>
      <div className="bar">
        <span style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
      </div>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function LeadTable({ leads, showReason }: { leads: Lead[]; showReason?: boolean }) {
  if (leads.length === 0) {
    return (
      <div className="panel">
        <Empty>No leads match this view yet. Run a campaign to populate it.</Empty>
      </div>
    );
  }

  return (
    <div className="panel table-wrap">
      <table>
        <thead>
          <tr>
            <th>Company</th>
            <th>Location</th>
            <th>ICP segment</th>
            <th>Score</th>
            <th>Conf.</th>
            <th>Tier</th>
            <th>Status</th>
            {showReason ? <th>Why</th> : <th>Outreach angle</th>}
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => (
            <tr key={lead.id}>
              <td>
                <Link href={`/leads/${lead.id}`}>
                  <strong>{lead.company_name}</strong>
                </Link>
                <div className="muted small">{lead.domain ?? '—'}</div>
              </td>
              <td className="nowrap small">
                {[lead.city, lead.country].filter(Boolean).join(', ') || '—'}
              </td>
              <td className="small">{lead.icp_segment ?? '—'}</td>
              <td>
                <ScoreBar score={lead.fit_score} />
              </td>
              <td>{lead.confidence ?? '—'}</td>
              <td>
                <Tier segment={lead.priority_segment} />
              </td>
              <td>
                <span className="pill">{lead.qualification_status}</span>
              </td>
              <td className="small muted">
                {showReason
                  ? lead.qualification_reason ?? '—'
                  : lead.outreach_angle ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
