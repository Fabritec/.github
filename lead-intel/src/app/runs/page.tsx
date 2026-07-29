import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

function summarise(criteria: Record<string, unknown>): string {
  const parts: string[] = [];
  const countries = criteria.countries as string[] | undefined;
  const queries = criteria.queries as string[] | undefined;
  const verticals = criteria.verticals as string[] | undefined;

  if (countries?.length) parts.push(countries.join(', '));
  if (verticals?.length) parts.push(verticals.join('/'));
  if (queries?.length) parts.push(`${queries.length} queries`);
  if (criteria.dry_run) parts.push('dry run');
  return parts.join(' · ') || '—';
}

export default async function RunsPage() {
  const store = await getStore();
  const runs = await store.listRuns(100);

  return (
    <>
      <h1>Generation runs</h1>
      <p className="subtitle">
        Every discovery operation, with what it found and what it rejected. The Run ID on each lead
        tells you exactly which run produced or last touched it.
      </p>

      {runs.length === 0 ? (
        <div className="panel">
          <div className="empty">No runs recorded yet.</div>
        </div>
      ) : (
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>Run ID</th>
                <th>Campaign</th>
                <th>Criteria</th>
                <th>Started</th>
                <th>Found</th>
                <th>Qualified</th>
                <th>Review</th>
                <th>Rejected</th>
                <th>Dupes</th>
                <th>Contacts</th>
                <th>Status</th>
                <th>Export</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td className="small nowrap">{run.run_ref}</td>
                  <td className="small">{run.campaign_name}</td>
                  <td className="small muted">
                    {summarise(run.criteria as unknown as Record<string, unknown>)}
                  </td>
                  <td className="small nowrap">
                    {run.started_at.slice(0, 16).replace('T', ' ')}
                  </td>
                  <td>{run.companies_found}</td>
                  <td>{run.companies_qualified}</td>
                  <td>{run.sent_to_review}</td>
                  <td>{run.rejected}</td>
                  <td>{run.duplicates_removed}</td>
                  <td>{run.contacts_found}</td>
                  <td>
                    <span className="pill">{run.status}</span>
                    {run.error && <div className="small muted">{run.error}</div>}
                  </td>
                  <td className="small muted">{run.export_filename ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
