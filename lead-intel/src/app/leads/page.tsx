import Link from 'next/link';
import { getStore } from '@/lib/store';
import type { PrioritySegment, QualificationStatus } from '@/lib/types';
import { LeadTable } from '../components';

export const dynamic = 'force-dynamic';

const STATUS_FILTERS: { key: string; label: string; statuses: QualificationStatus[] }[] = [
  { key: 'actionable', label: 'Actionable', statuses: ['qualified', 'nurture'] },
  { key: 'qualified', label: 'Qualified', statuses: ['qualified'] },
  { key: 'nurture', label: 'Nurture', statuses: ['nurture'] },
  { key: 'review', label: 'Review', statuses: ['review'] },
  { key: 'rejected', label: 'Rejected', statuses: ['rejected'] },
  { key: 'all', label: 'All', statuses: [] },
];

const TIERS: PrioritySegment[] = ['A', 'B', 'C', 'D'];

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; tier?: string; q?: string }>;
}) {
  const params = await searchParams;
  const activeKey = params.status ?? 'actionable';
  const filter = STATUS_FILTERS.find((f) => f.key === activeKey) ?? STATUS_FILTERS[0]!;
  const tier = TIERS.includes(params.tier as PrioritySegment)
    ? (params.tier as PrioritySegment)
    : undefined;

  const store = await getStore();
  const leads = await store.listLeads({
    statuses: filter.statuses.length > 0 ? filter.statuses : undefined,
    segments: tier ? [tier] : undefined,
    search: params.q,
    limit: 300,
  });

  const href = (next: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    const merged = { status: activeKey, tier, q: params.q, ...next };
    for (const [k, v] of Object.entries(merged)) if (v) sp.set(k, v);
    const qs = sp.toString();
    return qs ? `/leads?${qs}` : '/leads';
  };

  return (
    <>
      <h1>Leads</h1>
      <p className="subtitle">
        Showing {leads.length} lead{leads.length === 1 ? '' : 's'}. Scores are computed in code from
        model-extracted facts — open a lead to see the full breakdown.
      </p>

      <div className="toolbar">
        {STATUS_FILTERS.map((f) => (
          <Link
            key={f.key}
            href={href({ status: f.key })}
            className={f.key === activeKey ? 'active' : ''}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <div className="toolbar">
        <Link href={href({ tier: undefined })} className={!tier ? 'active' : ''}>
          All tiers
        </Link>
        {TIERS.map((t) => (
          <Link key={t} href={href({ tier: t })} className={tier === t ? 'active' : ''}>
            Tier {t}
          </Link>
        ))}
      </div>

      <form className="toolbar" action="/leads" method="get">
        <input type="hidden" name="status" value={activeKey} />
        {tier ? <input type="hidden" name="tier" value={tier} /> : null}
        <input
          type="search"
          name="q"
          defaultValue={params.q ?? ''}
          placeholder="Search company, domain or city"
          style={{
            padding: '6px 12px',
            border: '1px solid var(--border)',
            borderRadius: 8,
            background: 'var(--panel)',
            color: 'var(--text)',
            minWidth: 260,
          }}
        />
        <button className="button" type="submit">
          Search
        </button>
      </form>

      <LeadTable leads={leads} showReason={activeKey === 'rejected' || activeKey === 'review'} />
    </>
  );
}
