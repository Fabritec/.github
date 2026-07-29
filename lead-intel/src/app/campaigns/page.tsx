import { EXAMPLE_CAMPAIGNS } from '@/lib/campaign-config';
import { CampaignForm } from './form';

export const dynamic = 'force-dynamic';

export default function CampaignsPage() {
  const presets = Object.entries(EXAMPLE_CAMPAIGNS).map(([key, value]) => ({
    key,
    name: value.campaign_name ?? key,
    countries: value.countries ?? [],
    target: value.target_accounts ?? 200,
  }));

  return (
    <>
      <h1>New campaign</h1>
      <p className="subtitle">
        Discovery, enrichment, scoring and contact resolution run as one pass. Companies that fail
        the hard rules are rejected before any model call, so a wide search is cheap.
      </p>

      <div className="note">
        A large campaign takes a while and spends API credits. Start with a small target to check
        the criteria, or tick &ldquo;dry run&rdquo; to exercise the pipeline against bundled
        fixtures with no API calls at all.
      </div>

      <CampaignForm presets={presets} />

      <h2>Running from the command line</h2>
      <div className="panel" style={{ padding: '14px 16px' }}>
        <pre className="small" style={{ margin: 0, overflowX: 'auto' }}>
{`# built-in preset, with the .xlsx snapshot at the end
npm run campaign -- --preset ksa-heavy-fabrication

# ad-hoc criteria
npm run campaign -- --country "Saudi Arabia" --query "steel fabrication" --target 50

# an exhibitor list, enriched and scored like anything else
npm run campaign -- --import lists/steelfab-2026.csv --country "United Arab Emirates"

# no API calls, bundled fixtures
npm run campaign -- --dry-run`}
        </pre>
      </div>
    </>
  );
}
