'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { QualificationStatus } from '@/lib/types';

const CRM_STATUSES = ['new', 'contacted', 'replied', 'meeting', 'opportunity', 'won', 'lost'];

const QUALIFICATION_STATUSES: QualificationStatus[] = [
  'qualified',
  'nurture',
  'review',
  'rejected',
];

/**
 * The edit UI lives here rather than in the spreadsheet. The sheet is a
 * read-only view that gets replaced on every sync, so an edit made there would
 * be silently lost — this is the path that actually writes back to the store.
 */
export function LeadActions({
  leadId,
  crmStatus,
  assignedTo,
  notes,
  status,
}: {
  leadId: string;
  crmStatus: string;
  assignedTo: string | null;
  notes: string | null;
  status: QualificationStatus;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({
    crm_status: crmStatus,
    assigned_to: assignedTo ?? '',
    notes: notes ?? '',
    qualification_status: status,
  });

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);

    const response = await fetch(`/api/leads/${leadId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        crm_status: form.crm_status,
        assigned_to: form.assigned_to || null,
        notes: form.notes || null,
        qualification_status: form.qualification_status,
      }),
    });

    if (response.ok) {
      setMessage('Saved.');
      startTransition(() => router.refresh());
    } else {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setMessage(body.error ?? 'Save failed.');
    }
  }

  const field: React.CSSProperties = {
    width: '100%',
    padding: '6px 10px',
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg)',
    color: 'var(--text)',
    font: 'inherit',
  };

  return (
    <form className="panel" style={{ padding: '14px 16px', display: 'grid', gap: 10 }} onSubmit={save}>
      <label className="small">
        <span className="muted">CRM status</span>
        <select
          style={field}
          value={form.crm_status}
          onChange={(e) => setForm({ ...form, crm_status: e.target.value })}
        >
          {CRM_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      <label className="small">
        <span className="muted">Qualification</span>
        <select
          style={field}
          value={form.qualification_status}
          onChange={(e) =>
            setForm({ ...form, qualification_status: e.target.value as QualificationStatus })
          }
        >
          {QUALIFICATION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      <label className="small">
        <span className="muted">Assigned to</span>
        <input
          style={field}
          value={form.assigned_to}
          placeholder="Salesperson"
          onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}
        />
      </label>

      <label className="small">
        <span className="muted">Notes</span>
        <textarea
          style={{ ...field, minHeight: 70, resize: 'vertical' }}
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />
      </label>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button className="button" type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </button>
        {message && <span className="small muted">{message}</span>}
      </div>
    </form>
  );
}
