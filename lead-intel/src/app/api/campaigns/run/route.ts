import { NextResponse } from 'next/server';
import { z } from 'zod';
import { buildCriteria, EXAMPLE_CAMPAIGNS } from '@/lib/campaign-config';
import { runCampaign } from '@/lib/pipeline/run-campaign';
import { getStore } from '@/lib/store';

/**
 * Runs a campaign synchronously. Fine for the target sizes this app deals with
 * (tens to a few hundred accounts) but it will outlive a serverless request
 * timeout on a large run — use the CLI (`npm run campaign`) or a queue for those.
 */
export const maxDuration = 800;

const bodySchema = z.object({
  preset: z.string().optional(),
  campaign_name: z.string().max(120).optional(),
  countries: z.array(z.string()).default([]),
  cities: z.array(z.string()).default([]),
  queries: z.array(z.string()).default([]),
  verticals: z
    .array(z.enum(['steel', 'aluminium', 'precast', 'peb', 'modular', 'joinery', 'job_shop', 'other']))
    .default([]),
  exclude: z.array(z.string()).default([]),
  employees_min: z.number().int().min(0).nullable().default(null),
  employees_max: z.number().int().min(1).nullable().default(null),
  target_accounts: z.number().int().min(1).max(2000).default(50),
  contacts_per_company: z.number().int().min(0).max(10).default(3),
  dry_run: z.boolean().default(false),
});

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request body' },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const preset = input.preset ? EXAMPLE_CAMPAIGNS[input.preset] : undefined;
  if (input.preset && !preset) {
    return NextResponse.json({ error: `Unknown preset "${input.preset}"` }, { status: 400 });
  }

  // Explicit fields win over the preset; empty ones fall back to it.
  const criteria = buildCriteria({
    ...preset,
    campaign_name: input.campaign_name || preset?.campaign_name || 'Ad-hoc campaign',
    countries: input.countries.length > 0 ? input.countries : preset?.countries,
    cities: input.cities.length > 0 ? input.cities : preset?.cities,
    queries: input.queries.length > 0 ? input.queries : preset?.queries,
    verticals: input.verticals.length > 0 ? input.verticals : preset?.verticals,
    exclude: input.exclude.length > 0 ? input.exclude : preset?.exclude,
    employees_min: input.employees_min ?? preset?.employees_min ?? null,
    employees_max: input.employees_max ?? preset?.employees_max ?? null,
    target_accounts: input.target_accounts,
    contacts_per_company: input.contacts_per_company,
    dry_run: input.dry_run,
  });

  try {
    const store = await getStore();
    const result = await runCampaign({ criteria, store });
    return NextResponse.json({
      run: result.run,
      new_leads: result.newLeads.length,
      updated_leads: result.updatedLeads.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
