import Link from 'next/link';
import { getStore } from '@/lib/store';
import { groupIntoSegments } from '@/lib/icp/segments';
import { LeadTable, Stat } from './components';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const store = await getStore();
  const leads = await store.listLeads();
  const contacts = await store.listContacts();
  const runs = await store.listRuns(5);

  const qualified = leads.filter((l) => l.qualification_status === 'qualified');
  const nurture = leads.filter((l) => l.qualification_status === 'nurture');
  const review = leads.filter((l) => l.qualification_status === 'review');
  const rejected = leads.filter((l) => l.qualification_status === 'rejected');

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const newThisWeek = [...qualified, ...nurture].filter((l) => l.first_seen_at >= weekAgo);

  const segments = groupIntoSegments([...qualified, ...nurture]).slice(0, 8);
  const topLeads = qualified.slice(0, 10);

  return (
    <>
      <h1>Dashboard</h1>
      <p className="subtitle">
        {leads.length === 0
          ? 'No leads yet. Start with a campaign, or run `npm run campaign -- --dry-run` to see the pipeline work.'
          : 'Supabase is the source of truth. The spreadsheet is a view of it.'}
      </p>

      <div className="cards">
        <Stat label="Qualified (A+B)" value={qualified.length} />
        <Stat label="Nurture (C)" value={nurture.length} />
        <Stat label="Awaiting review" value={review.length} />
        <Stat label="Rejected" value={rejected.length} />
        <Stat label="Contacts" value={contacts.length} />
        <Stat label="New this week" value={newThisWeek.length} />
      </div>

      {review.length > 0 && (
        <div className="note" style={{ marginTop: 18 }}>
          {review.length} lead{review.length === 1 ? '' : 's'} scored well but could not be
          verified from available evidence.{' '}
          <Link href="/review">Review them</Link> before they go to outreach.
        </div>
      )}

      <h2>Top segments</h2>
      {segments.length === 0 ? (
        <div className="panel">
          <div className="empty">Segments appear automatically once leads are qualified.</div>
        </div>
      ) : (
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>Segment</th>
                <th>Leads</th>
                <th>Average score</th>
              </tr>
            </thead>
            <tbody>
              {segments.map((segment) => (
                <tr key={segment.key}>
                  <td>
                    <Link href={`/segments#${encodeURIComponent(segment.key)}`}>
                      {segment.label}
                    </Link>
                  </td>
                  <td>{segment.count}</td>
                  <td>{segment.avg_score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Highest-scoring qualified leads</h2>
      <LeadTable leads={topLeads} />

      <h2>Recent runs</h2>
      {runs.length === 0 ? (
        <div className="panel">
          <div className="empty">No runs yet.</div>
        </div>
      ) : (
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>Run</th>
                <th>Campaign</th>
                <th>Found</th>
                <th>Qualified</th>
                <th>Review</th>
                <th>Rejected</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td className="nowrap small">
                    <Link href="/runs">{run.run_ref}</Link>
                  </td>
                  <td className="small">{run.campaign_name}</td>
                  <td>{run.companies_found}</td>
                  <td>{run.companies_qualified}</td>
                  <td>{run.sent_to_review}</td>
                  <td>{run.rejected}</td>
                  <td>
                    <span className="pill">{run.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
