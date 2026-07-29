'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Preset {
  key: string;
  name: string;
  countries: string[];
  target: number;
}

const VERTICALS = ['steel', 'aluminium', 'precast', 'peb', 'modular', 'joinery', 'job_shop'];

export function CampaignForm({ presets }: { presets: Preset[] }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    preset: '',
    campaign_name: '',
    countries: '',
    cities: '',
    queries: '',
    verticals: [] as string[],
    employees_min: '20',
    employees_max: '250',
    target_accounts: '25',
    contacts_per_company: '3',
    exclude: 'trading, distributor, wholesale',
    dry_run: true,
  });

  const field: React.CSSProperties = {
    width: '100%',
    padding: '7px 10px',
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg)',
    color: 'var(--text)',
    font: 'inherit',
  };

  const list = (value: string): string[] =>
    value
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setRunning(true);
    setResult(null);
    setError(null);

    try {
      const response = await fetch('/api/campaigns/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preset: form.preset || undefined,
          campaign_name: form.campaign_name || undefined,
          countries: list(form.countries),
          cities: list(form.cities),
          queries: list(form.queries),
          verticals: form.verticals,
          exclude: list(form.exclude),
          employees_min: form.employees_min ? Number(form.employees_min) : null,
          employees_max: form.employees_max ? Number(form.employees_max) : null,
          target_accounts: Number(form.target_accounts) || 25,
          contacts_per_company: Number(form.contacts_per_company) || 3,
          dry_run: form.dry_run,
        }),
      });

      const body = (await response.json()) as {
        error?: string;
        run?: {
          run_ref: string;
          companies_found: number;
          companies_qualified: number;
          sent_to_review: number;
          rejected: number;
          contacts_found: number;
        };
        new_leads?: number;
        updated_leads?: number;
      };

      if (!response.ok || !body.run) {
        setError(body.error ?? 'Campaign failed.');
        return;
      }

      setResult(
        `${body.run.run_ref}: ${body.run.companies_found} found, ${body.run.companies_qualified} qualified, ` +
          `${body.run.sent_to_review} to review, ${body.run.rejected} rejected, ` +
          `${body.run.contacts_found} contacts (${body.new_leads ?? 0} new, ${body.updated_leads ?? 0} updated).`,
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <form className="panel" style={{ padding: '18px 20px', display: 'grid', gap: 14 }} onSubmit={submit}>
      <label className="small">
        <span className="muted">Preset</span>
        <select
          style={field}
          value={form.preset}
          onChange={(e) => setForm({ ...form, preset: e.target.value })}
        >
          <option value="">Custom criteria</option>
          {presets.map((p) => (
            <option key={p.key} value={p.key}>
              {p.name}
            </option>
          ))}
        </select>
        <span className="muted">
          A preset fills in countries, cities, queries and verticals. Anything you type below
          overrides it.
        </span>
      </label>

      <label className="small">
        <span className="muted">Campaign name</span>
        <input
          style={field}
          value={form.campaign_name}
          placeholder="Q3 Saudi fabricators"
          onChange={(e) => setForm({ ...form, campaign_name: e.target.value })}
        />
      </label>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
        <label className="small">
          <span className="muted">Countries (comma separated)</span>
          <input
            style={field}
            value={form.countries}
            placeholder="Saudi Arabia, Egypt"
            onChange={(e) => setForm({ ...form, countries: e.target.value })}
          />
        </label>

        <label className="small">
          <span className="muted">Search cities</span>
          <input
            style={field}
            value={form.cities}
            placeholder="Riyadh, Dammam, Jubail"
            onChange={(e) => setForm({ ...form, cities: e.target.value })}
          />
        </label>
      </div>

      <label className="small">
        <span className="muted">Search queries</span>
        <input
          style={field}
          value={form.queries}
          placeholder="steel fabrication, PEB manufacturer, precast concrete factory"
          onChange={(e) => setForm({ ...form, queries: e.target.value })}
        />
      </label>

      <fieldset style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
        <legend className="small muted">Verticals (empty = all)</legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {VERTICALS.map((v) => (
            <label key={v} className="small" style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={form.verticals.includes(v)}
                onChange={(e) =>
                  setForm({
                    ...form,
                    verticals: e.target.checked
                      ? [...form.verticals, v]
                      : form.verticals.filter((x) => x !== v),
                  })
                }
              />
              {v}
            </label>
          ))}
        </div>
      </fieldset>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14 }}>
        <label className="small">
          <span className="muted">Min employees</span>
          <input
            style={field}
            type="number"
            value={form.employees_min}
            onChange={(e) => setForm({ ...form, employees_min: e.target.value })}
          />
        </label>
        <label className="small">
          <span className="muted">Max employees</span>
          <input
            style={field}
            type="number"
            value={form.employees_max}
            onChange={(e) => setForm({ ...form, employees_max: e.target.value })}
          />
        </label>
        <label className="small">
          <span className="muted">Target accounts</span>
          <input
            style={field}
            type="number"
            value={form.target_accounts}
            onChange={(e) => setForm({ ...form, target_accounts: e.target.value })}
          />
        </label>
        <label className="small">
          <span className="muted">Contacts per company</span>
          <input
            style={field}
            type="number"
            value={form.contacts_per_company}
            onChange={(e) => setForm({ ...form, contacts_per_company: e.target.value })}
          />
        </label>
      </div>

      <label className="small">
        <span className="muted">Exclusions</span>
        <input
          style={field}
          value={form.exclude}
          onChange={(e) => setForm({ ...form, exclude: e.target.value })}
        />
      </label>

      <label className="small" style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={form.dry_run}
          onChange={(e) => setForm({ ...form, dry_run: e.target.checked })}
        />
        Dry run — use bundled fixtures, make no API calls
      </label>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="button" type="submit" disabled={running}>
          {running ? 'Running…' : 'Run campaign'}
        </button>
        {running && (
          <span className="small muted">
            Discovery, enrichment and scoring run synchronously — this can take a few minutes.
          </span>
        )}
      </div>

      {result && <div className="note">{result}</div>}
      {error && (
        <div className="note" style={{ background: 'var(--d-bg)', color: 'var(--d)' }}>
          {error}
        </div>
      )}
    </form>
  );
}
