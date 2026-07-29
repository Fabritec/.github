import { readFile } from 'node:fs/promises';
import { NextResponse } from 'next/server';
import { exportWorkbook } from '@/lib/export/excel';
import { isGoogleSheetsConfigured, syncToGoogleSheets } from '@/lib/export/google-sheets';
import { getStore } from '@/lib/store';

/** GET /api/export → download a fresh .xlsx snapshot. */
export async function GET() {
  const store = await getStore();
  const result = await exportWorkbook(store);
  const buffer = await readFile(result.path);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${result.filename}"`,
      'Content-Length': String(buffer.byteLength),
    },
  });
}

/** POST /api/export → push the current state to the shared Google Sheet. */
export async function POST() {
  if (!isGoogleSheetsConfigured()) {
    return NextResponse.json(
      {
        error:
          'Google Sheets is not configured. Set GOOGLE_SHEETS_SPREADSHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.',
      },
      { status: 400 },
    );
  }

  try {
    const store = await getStore();
    const result = await syncToGoogleSheets(store);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
