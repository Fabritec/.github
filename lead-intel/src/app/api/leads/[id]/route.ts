import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getStore } from '@/lib/store';

const patchSchema = z.object({
  crm_status: z.string().min(1).max(40).optional(),
  assigned_to: z.string().max(120).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  qualification_status: z
    .enum(['qualified', 'nurture', 'rejected', 'review', 'pending'])
    .optional(),
});

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const store = await getStore();
  const lead = await store.getLead(id);
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

  const [contacts, evidence] = await Promise.all([
    store.listContacts([id]),
    store.listEvidence([id]),
  ]);
  return NextResponse.json({ lead, contacts, evidence });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request body' },
      { status: 400 },
    );
  }

  const store = await getStore();
  const updated = await store.updateLeadFields(id, parsed.data);
  if (!updated) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
  await store.flush();

  return NextResponse.json({ lead: updated });
}
