#!/usr/bin/env tsx
/**
 * Seeds the local JSON store from fixtures and writes a workbook, so you can
 * see what the app looks like populated before wiring up any API keys.
 *
 *   npm run seed:demo
 *   npm run dev
 */

import { rm } from 'node:fs/promises';
import { buildCriteria } from '../src/lib/campaign-config.js';
import { exportWorkbook } from '../src/lib/export/excel.js';
import { runCampaign } from '../src/lib/pipeline/run-campaign.js';
import { config } from '../src/lib/config.js';
import { JsonLeadStore } from '../src/lib/store/index.js';
import { log } from '../src/lib/logger.js';
import { parseArgs } from './args.js';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.flag('reset')) {
    await rm(config.storage.jsonPath, { force: true });
    log.info(`Removed ${config.storage.jsonPath}`);
  }

  const store = new JsonLeadStore(config.storage.jsonPath);
  await store.init();

  const result = await runCampaign({
    criteria: buildCriteria({
      campaign_name: 'Demo — bundled fixtures',
      dry_run: true,
      target_accounts: 50,
    }),
    store,
  });

  const exported = await exportWorkbook(store);
  await store.updateRun(result.run.id, { export_filename: exported.filename });
  await store.flush();

  log.info('');
  log.info(`Seeded ${result.newLeads.length + result.updatedLeads.length} demo leads.`);
  log.info(`Store:    ${config.storage.jsonPath}`);
  log.info(`Workbook: ${exported.path}`);
  log.info('');
  log.info('Run `npm run dev` and open http://localhost:3000');
  log.info('Every fixture company is invented — the names are marked "Sample"/"Example".');
}

main().catch((err) => {
  log.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exitCode = 1;
});
