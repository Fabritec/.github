#!/usr/bin/env tsx
/**
 * On-demand .xlsx snapshot.
 *
 *   npm run export:xlsx
 *   npm run export:xlsx -- --out exports/board-review.xlsx --new-since 2026-07-01
 */

import { exportWorkbook } from '../src/lib/export/excel.js';
import { getStore } from '../src/lib/store/index.js';
import { log } from '../src/lib/logger.js';
import { parseArgs, printHelp } from './args.js';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.flag('help') || args.flag('h')) {
    printHelp('export:xlsx', [
      ['--out <path>', 'Output file path (default exports/fabritec-leads-<date>.xlsx)'],
      ['--new-since <date>', 'ISO date for the "New This Week" tab (default: 7 days ago)'],
      ['--no-segment-tabs', 'Skip the per-segment tabs'],
    ]);
    return;
  }

  const store = await getStore();
  const newSince = args.value('new-since');

  const result = await exportWorkbook(store, {
    outPath: args.value('out'),
    newSince: newSince ? new Date(newSince).toISOString() : undefined,
    includeSegmentTabs: !args.flag('no-segment-tabs'),
  });

  log.info(`Wrote ${result.path}`);
  log.info(`  ${result.sheetCount} sheets, ${result.rowCount} data rows`);
}

main().catch((err) => {
  log.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exitCode = 1;
});
