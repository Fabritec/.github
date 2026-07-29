#!/usr/bin/env tsx
/**
 * Nightly Google Sheets sync. Intended to run on a cron:
 *
 *   0 2 * * *  cd /srv/lead-intel && npm run sync:sheets
 */

import { isGoogleSheetsConfigured, syncToGoogleSheets } from '../src/lib/export/google-sheets.js';
import { getStore } from '../src/lib/store/index.js';
import { log } from '../src/lib/logger.js';
import { parseArgs, printHelp } from './args.js';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.flag('help') || args.flag('h')) {
    printHelp('sync:sheets', [
      ['--new-since <date>', 'ISO date for the "New This Week" tab (default: 7 days ago)'],
      ['--no-segment-tabs', 'Skip the per-segment tabs'],
    ]);
    return;
  }

  if (!isGoogleSheetsConfigured()) {
    log.error(
      'Google Sheets is not configured. Set GOOGLE_SHEETS_SPREADSHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL\n' +
        'and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY, and share the spreadsheet with the service account as Editor.',
    );
    process.exitCode = 1;
    return;
  }

  const store = await getStore();
  const newSince = args.value('new-since');

  const result = await syncToGoogleSheets(store, {
    newSince: newSince ? new Date(newSince).toISOString() : undefined,
    includeSegmentTabs: !args.flag('no-segment-tabs'),
  });

  log.info(
    `Synced ${result.tabsWritten} tabs, ${result.rowsWritten} rows → https://docs.google.com/spreadsheets/d/${result.spreadsheetId}`,
  );
}

main().catch((err) => {
  log.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exitCode = 1;
});
