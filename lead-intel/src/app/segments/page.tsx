import Link from 'next/link';
import { getStore } from '@/lib/store';
import { groupIntoSegments } from '@/lib/icp/segments';
import { ScoreBar, Tier } from '../components';

export const dynamic = 'force-dynamic';

export default async function SegmentsPage() {
  const store = await getStore();
  const leads = await store.listLeads({ statuses: ['qualified', 'nurture'] });
  const segments = groupIntoSegments(leads);

  return (
    <>
      <h1>Segments</h1>
      <p className="subtitle">
        Derived automatically from vertical × country × capacity band × score tier. Nothing here is
        hand-maintained — add a country to a campaign and its segments appear on the next run.
      </p>

      {segments.length === 0 ? (
        <div className="panel">
          <div className="empty">No qualified leads yet, so there are no segments to derive.</div>
        </div>
      ) : (
        segments.map((segment) => (
          <section key={segment.key} id={segment.key} style={{ marginBottom: 30 }}>
            <h2 style={{ marginBottom: 8 }}>
              <Tier segment={segment.parts.tier} /> {segment.label}
            </h2>
            <p className="subtitle" style={{ marginBottom: 10 }}>
              {segment.count} lead{segment.count === 1 ? '' : 's'} · average score{' '}
              {segment.avg_score} · <code className="small">{segment.key}</code>
            </p>
            <div className="panel table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Location</th>
                    <th>Score</th>
                    <th>Confidence</th>
                    <th>Outreach angle</th>
                  </tr>
                </thead>
                <tbody>
                  {segment.leads.map((lead) => (
                    <tr key={lead.id}>
                      <td>
                        <Link href={`/leads/${lead.id}`}>
                          <strong>{lead.company_name}</strong>
                        </Link>
                      </td>
                      <td className="small nowrap">
                        {[lead.city, lead.country].filter(Boolean).join(', ') || '—'}
                      </td>
                      <td>
                        <ScoreBar score={lead.fit_score} />
                      </td>
                      <td>{lead.confidence ?? '—'}</td>
                      <td className="small muted">{lead.outreach_angle ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </>
  );
}
