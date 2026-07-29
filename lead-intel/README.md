# Fabritec Lead Intelligence

An internal app that finds manufacturing companies, qualifies them against Fabritec's ICP,
identifies the buying committee, segments them automatically, and exports an Excel workbook that
gets updated rather than re-created.

The operating principle: **buy access to reliable company and contact data, build the
Fabritec-specific qualification intelligence.** The system does not scrape LinkedIn and never asks
a model to invent a contact detail.

```
Campaign
  → Discovery            Google Places grid, Apollo, CSV imports
  → Dedupe               domain → provider id → name+country
  → Hard rules           reject traders/contractors before spending anything
  → Website read         homepage + capability/facility/quality/project pages
  → AI fact extraction   schema-constrained, evidence-backed, facts only
  → Hard rules again     now against real facts
  → Contact resolution   only for companies that passed
  → Scoring              rubric in code, not in the prompt
  → Segmentation         derived, never hand-maintained
  → Database             Supabase is the source of truth
  → Excel / Sheets       views of the database
```

---

## Try it without any API keys

```bash
npm install
npm run seed:demo     # runs the pipeline against bundled fixtures
npm run dev           # http://localhost:3000
```

That populates the local JSON store and writes a real workbook to `exports/`. Every fixture company
is invented and named `Sample`/`Example` — fixtures must never carry fabricated claims about a real
business, because fixture rows and live rows end up in the same sheet.

---

## The part that matters: scoring

**The model returns facts. The rubric turns facts into a number.** That separation is the whole
design, and it buys three things: the score is auditable line by line, a rubric change can be
replayed over stored facts without re-paying for enrichment, and the model is never in a position
to talk itself into liking a lead.

The prompt contains no scoring instructions, no tiers, and no notion of a "good" company. It asks
for what a careful analyst would read off the page:

```jsonc
{
  "vertical": "steel",
  "manufacturing_model": "project_based",
  "uses_drawings_boms_revisions": true,
  "detailing_software": ["Tekla Structures"],
  "estimated_capacity_tpm": 600,
  "plants": 2,
  "evidence": [{ "claim": "...", "finding": "...", "source_url": "...", "strength": "strong" }],
  "confidence": "high"
}
```

### The rubric — `src/lib/icp/rubric.ts`

| Factor | Points |
| --- | --- |
| Industry and ICP fit | 20 |
| Project-, job- or order-based manufacturing | 15 |
| Uses drawings, BOMs or revisions | 15 |
| Multi-stage production complexity | 15 |
| QC, shipping or installation complexity | 10 |
| Company size and geography | 10 |
| Signs of Excel/manual tracking | 5 |
| Appropriate decision-maker available | 5 |
| Strength of available evidence | 5 |

Plus Fabritec-specific bonuses, capped at 100:

| Bonus | Points |
| --- | --- |
| **Runs Tekla or Advance Steel** | **+10** |
| Other detailing/CAD software | +4 |
| Published portfolio of named projects | +3 |
| Multiple production plants | +3 |

The Tekla/Advance Steel weighting is deliberate and heavy: XSR ingestion is the wedge, so a shop
already detailing in Tekla is a materially shorter sale than an otherwise identical shop that isn't.

| Score | Segment | Action |
| --- | --- | --- |
| 80–100 | A — Priority | Immediate personalised outreach |
| 65–79 | B — Qualified | Sales development outreach |
| 50–64 | C — Nurture | Research further or use marketing |
| Below 50 | D — Reject | Do not contact automatically |

### Confidence is separate from fit

A company can look excellent and still be unverifiable. Confidence measures *how much to trust the
score*, from evidence count, evidence strength, source URLs and field completeness.

- Confidence below **55** → the lead goes to the **review queue**, never to the outreach sheet.
- No evidence at all → confidence is **capped at 40**. Unverifiable by construction, whatever the
  model's self-reported confidence said.
- Low confidence **and** a fit score below 40 → rejected outright rather than queued, so the review
  queue stays a list of real maybes instead of everything enrichment failed to read.

### A note on calibration

The 100-point table rewards things most genuine fabricators have — drawings, multi-stage
production, QC. In practice that means real fabricators cluster high, and most of the discrimination
comes from the hard rules (which remove traders, contractors and mass producers entirely) and from
the bonuses. That is a reasonable place to start, but **expect to tune the weights once you have
50–100 scored companies and know what a real A looks like.** Everything is in one file, and
`npm test` covers the behaviour you'd want to preserve while changing them.

---

## Where leads come from

| Source | Role | Configured by |
| --- | --- | --- |
| Google Places (New) | Local fabricators across MENA, run as a `query × city` grid | `GOOGLE_PLACES_API_KEY` |
| Apollo | Company search, plus the people layer once a company is a fit | `APOLLO_API_KEY` |
| Hunter | Email finding and verification | `HUNTER_API_KEY` |
| Company websites | The actual qualification evidence | — |
| CSV imports | SteelFab / Big 5 exhibitor lists, contractor registries, AISC-certified lists | `--import file.csv` |

Places is the workhorse: Apollo and ZoomInfo have thin MENA fabricator coverage, while a Places grid
over Cairo, Alexandria, 10th of Ramadan, Riyadh, Dammam, Jubail, Sharjah, Dubai and Doha returns
name, site, phone and address cheaply. Apollo earns its keep on the *people* layer, once you already
know the company fits.

Imported lists go through the identical enrichment, scoring and dedupe path as API discoveries — no
shortcuts, because an exhibitor list is a lead source, not a verified lead.

---

## Never duplicate, always update

Company matching, in order:

1. Normalised website domain
2. Provider company id
3. Normalised company name + country

Contact matching, in order:

1. Verified email
2. Provider person id
3. Full name + company domain

Every lead carries `first_seen_at`, `last_seen_at`, `last_enriched_at`, `original_run_id`,
`latest_run_id`, `previous_score`, `current_score` and `changed_fields`. The workbook uses those for
its **New This Week** and **Score Movement** tabs, so you can see what actually moved between runs
rather than diffing spreadsheets by eye.

---

## Segments are derived

`vertical × country × capacity band × score tier`, computed on every run. Nothing is
hand-maintained: add a country to a campaign and its segments — and their sheet tabs — appear on the
next run. Empty segment tabs are removed from the Google Sheet automatically.

---

## The Excel part

**Supabase is the source of truth. The spreadsheet is a view.**

Two outputs:

- **Google Sheet**, re-synced nightly — one tab per segment plus the standard tabs. The sync is a
  full replace, so anyone editing the sheet directly loses their edits. Both the workbook and every
  synced tab carry a banner saying so, and the edit UI lives in the app (`/leads/[id]`) where writes
  actually persist.
- **`.xlsx` snapshot**, on demand, via `npm run export:xlsx` or `GET /api/export`.

Tabs: `Summary`, `Qualified Leads`, `Contacts`, `Evidence`, `Review Queue`, `Rejected Leads`,
`Generation Runs`, `New This Week`, `Score Movement`, then one tab per derived segment.

Two-way sync is deliberately not built. Reconciling arbitrary spreadsheet edits against a database
is a much larger problem than it looks, and it isn't worth taking on for a view.

---

## Setup

```bash
cp .env.example .env.local
```

Nothing is required to try the app. For live runs:

| Variable | Needed for |
| --- | --- |
| `ANTHROPIC_API_KEY` | Enrichment. Without it, companies land unenriched in the review queue. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | The real database. Falls back to a local JSON file. |
| `GOOGLE_PLACES_API_KEY` | Places discovery (enable "Places API (New)"). |
| `APOLLO_API_KEY` | Company and people search. |
| `HUNTER_API_KEY` | Email finding and verification. |
| `GOOGLE_SHEETS_*`, `GOOGLE_SERVICE_ACCOUNT_*` | The shared sheet. Share it with the service account as Editor. |

Then create the schema — run `supabase/migrations/0001_init.sql` in the Supabase SQL editor.

> The service-role key bypasses RLS, so `src/lib/store/supabase-store.ts` must only ever be imported
> from server-side code. It is never imported from a client component.

---

## Commands

```bash
npm run dev                                     # the app
npm run campaign -- --preset ksa-heavy-fabrication
npm run campaign -- --country "Saudi Arabia" --query "steel fabrication" --target 50
npm run campaign -- --import lists/steelfab-2026.csv --country "United Arab Emirates"
npm run campaign -- --dry-run                   # fixtures, no API calls
npm run export:xlsx
npm run sync:sheets
npm test
npm run typecheck
```

`npm run campaign -- --help` lists every flag. Presets live in `src/lib/campaign-config.ts`.

The nightly sheet sync runs from `.github/workflows/lead-intel-nightly-sync.yml` at the repository
root. It skips itself cleanly until the repository secrets are set.

---

## Layout

```
src/lib/icp/          rubric, hard rules, scoring, segments, personas  ← the Fabritec logic
src/lib/ai/           schema, prompts, enrichment call
src/lib/sources/      google-places, apollo, hunter, website, import-list, fixtures
src/lib/pipeline/     orchestrator, dedupe, contact resolution
src/lib/store/        LeadStore interface + Supabase and JSON adapters
src/lib/export/       shared workbook builder, ExcelJS, Google Sheets
src/app/              Next.js UI and API routes
supabase/migrations/  schema
test/                 scoring, hard rules, dedupe, segments, CSV import
```

---

## What this deliberately does not do

- **No LinkedIn scraping.** Operationally fragile, and it puts accounts and compliance at risk.
- **No AI-invented contact details.** Emails come from Apollo or Hunter and are verified, or the
  field stays empty.
- **No scoring inside the prompt.** Facts from the model, numbers from code.
- **No two-way spreadsheet sync.** See above.
