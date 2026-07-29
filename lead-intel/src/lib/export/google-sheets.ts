/**
 * Nightly Google Sheets sync — the view the whole team looks at.
 *
 * The sync is a full replace, deliberately. Anyone editing the sheet directly
 * loses their edits on the next run, so the sheet is banner-marked read-only and
 * the edit UI lives in the app. Two-way sync would mean reconciling arbitrary
 * spreadsheet edits against the database, which is a much larger problem than it
 * looks and not one worth taking on for a view.
 */

import { google, type sheets_v4 } from 'googleapis';
import { config } from '../config.js';
import { log } from '../logger.js';
import type { LeadStore } from '../store/index.js';
import { buildWorkbookData, type BuildWorkbookOptions, type SheetTable } from './workbook.js';

export function isGoogleSheetsConfigured(): boolean {
  return (
    config.googleSheets.spreadsheetId !== null &&
    config.googleSheets.serviceAccountEmail !== null &&
    config.googleSheets.privateKey !== null
  );
}

function sheetsClient(): sheets_v4.Sheets {
  const auth = new google.auth.JWT({
    email: config.googleSheets.serviceAccountEmail!,
    key: config.googleSheets.privateKey!,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

export interface SyncResult {
  spreadsheetId: string;
  tabsWritten: number;
  rowsWritten: number;
  tabsRemoved: number;
}

export async function syncToGoogleSheets(
  store: LeadStore,
  options: BuildWorkbookOptions = {},
): Promise<SyncResult> {
  if (!isGoogleSheetsConfigured()) {
    throw new Error(
      'Google Sheets sync needs GOOGLE_SHEETS_SPREADSHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
    );
  }

  const spreadsheetId = config.googleSheets.spreadsheetId!;
  const sheets = sheetsClient();
  const data = await buildWorkbookData(store, options);

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = new Map<string, number>();
  for (const sheet of meta.data.sheets ?? []) {
    const title = sheet.properties?.title;
    const id = sheet.properties?.sheetId;
    if (title && typeof id === 'number') existing.set(title, id);
  }

  const wanted = data.sheets.map((s) => s.name);

  // Create tabs that don't exist yet.
  const toCreate = wanted.filter((name) => !existing.has(name));
  if (toCreate.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: toCreate.map((title) => ({ addSheet: { properties: { title } } })),
      },
    });
  }

  // Clear everything we're about to rewrite, so removed leads actually disappear.
  await sheets.spreadsheets.values.batchClear({
    spreadsheetId,
    requestBody: { ranges: wanted.map((name) => `${quote(name)}!A:ZZ`) },
  });

  let rowsWritten = 0;
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: data.sheets.map((table) => {
        const values = toValues(table, data.generatedAt);
        rowsWritten += values.length;
        return { range: `${quote(table.name)}!A1`, values };
      }),
    },
  });

  // Drop segment tabs whose segment no longer has any leads, but never touch a
  // tab a human created — only ones this sync is responsible for.
  const managedPrefixes = ['A-', 'B-', 'C-', 'D-'];
  const stale = [...existing.keys()].filter(
    (name) => !wanted.includes(name) && managedPrefixes.some((p) => name.startsWith(p)),
  );
  if (stale.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: stale.map((name) => ({ deleteSheet: { sheetId: existing.get(name)! } })),
      },
    });
  }

  await formatHeaders(sheets, spreadsheetId, wanted);

  log.info(
    `Synced ${wanted.length} tabs / ${rowsWritten} rows to spreadsheet ${spreadsheetId}` +
      (stale.length > 0 ? ` (removed ${stale.length} empty segment tabs)` : ''),
  );

  return {
    spreadsheetId,
    tabsWritten: wanted.length,
    rowsWritten,
    tabsRemoved: stale.length,
  };
}

function toValues(table: SheetTable, generatedAt: string): (string | number)[][] {
  const banner = [
    `${table.name} · synced ${generatedAt.slice(0, 19).replace('T', ' ')} UTC · read-only view, edits here are overwritten nightly`,
  ];
  const header = table.columns.map((c) => c.header);
  const rows = table.rows.map((row) => row.map((cell) => (cell === null ? '' : cell)));
  return [banner, header, ...rows];
}

/** Bold+freeze the header row on every managed tab. */
async function formatHeaders(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabNames: string[],
): Promise<void> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const ids = new Map<string, number>();
  for (const sheet of meta.data.sheets ?? []) {
    const title = sheet.properties?.title;
    const id = sheet.properties?.sheetId;
    if (title && typeof id === 'number') ids.set(title, id);
  }

  const requests: sheets_v4.Schema$Request[] = [];
  for (const name of tabNames) {
    const sheetId = ids.get(name);
    if (sheetId === undefined) continue;

    requests.push({
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 2 } },
        fields: 'gridProperties.frozenRowCount',
      },
    });
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 1, endRowIndex: 2 },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
            backgroundColor: { red: 0.12, green: 0.23, blue: 0.37 },
          },
        },
        fields: 'userEnteredFormat(textFormat,backgroundColor)',
      },
    });
  }

  if (requests.length > 0) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
  }
}

/** Sheet names with spaces or quotes need quoting inside an A1 range. */
function quote(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}
