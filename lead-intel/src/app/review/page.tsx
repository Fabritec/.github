import { getStore } from '@/lib/store';
import { LeadTable } from '../components';

export const dynamic = 'force-dynamic';

export default async function ReviewPage() {
  const store = await getStore();
  const leads = await store.listLeads({ statuses: ['review'], limit: 300 });

  return (
    <>
      <h1>Review queue</h1>
      <p className="subtitle">
        These companies could plausibly qualify, but the evidence behind the score was too thin to
        trust. Nothing here is exported as a qualified lead until a human confirms it.
      </p>

      <div className="note">
        A lead lands here when confidence falls below the auto-qualify bar — usually a thin website,
        a failed fetch, or a fact set the model could not ground in anything it read. Open a lead to
        see what was missing, then set it to qualified or rejected.
      </div>

      <LeadTable leads={leads} showReason />
    </>
  );
}
