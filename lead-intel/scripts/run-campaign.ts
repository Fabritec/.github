#!/usr/bin/env tsx
/**
 * Campaign runner.
 *
 *   npm run campaign -- --preset ksa-heavy-fabrication
 *   npm run campaign -- --country "Saudi Arabia" --query "steel fabrication" --target 50
 *   npm run campaign -- --dry-run --country Egypt
 *   npm run campaign -- --import lists/steelfab-2026.csv --country "United Arab Emirates"
 */

import { buildCriteria, EXAMPLE_CAMPAIGNS, parseSources, parseVerticals } from '../src/lib/campaign-config.js';
import { exportWorkbook } from '../src/lib/export/excel.js';
import { runCampaign } from '../src/lib/pipeline/run-campaign.js';
import { dedupeBatch } from '../src/lib/pipeline/dedupe.js';
import { loadCompanyListFile } from '../src/lib/sources/import-list.js';
import { getStore } from '../src/lib/store/index.js';
import type { DiscoveredCompany } from '../src/lib/types.js';
import { log } from '../src/lib/logger.js';
import { parseArgs, printHelp } from './args.js';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.flag('help') || args.flag('h')) {
    printHelp('run-campaign', [
      ['--preset <name>', `Use a built-in campaign (${Object.keys(EXAMPLE_CAMPAIGNS).join(', ')})`],
      ['--name <text>', 'Campaign name recorded on the run'],
      ['--country <c>', 'Target country (repeatable)'],
      ['--city <c>', 'Search city for the Places grid (repeatable)'],
      ['--query <q>', 'Search phrase (repeatable)'],
      ['--vertical <v>', 'Restrict to a vertical (repeatable)'],
      ['--source <s>', 'Discovery source: google_places, apollo (repeatable)'],
      ['--exclude <term>', 'Exclusion term (repeatable)'],
      ['--min-employees <n>', 'Lower bound on headcount'],
      ['--max-employees <n>', 'Upper bound on headcount'],
      ['--target <n>', 'How many accounts to process (default 200)'],
      ['--contacts <n>', 'Contacts per qualified company (default 3)'],
      ['--import <file.csv>', 'Add companies from a CSV list (exhibitors, directories)'],
      ['--dry-run', 'Use bundled fixtures, make no API calls'],
      ['--no-export', 'Skip writing the .xlsx snapshot at the end'],
    ]);
    return;
  }

  const presetName = args.value('preset');
  const preset = presetName ? EXAMPLE_CAMPAIGNS[presetName] : undefined;
  if (presetName && !preset) {
    throw new Error(
      `Unknown preset "${presetName}". Available: ${Object.keys(EXAMPLE_CAMPAIGNS).join(', ')}`,
    );
  }

  const countries = args.values('country');
  const cities = args.values('city');
  const queries = args.values('query');
  const verticals = parseVerticals(args.values('vertical'));
  const sources = parseSources(args.values('source'));
  const excludes = args.values('exclude');

  const criteria = buildCriteria({
    ...preset,
    campaign_name: args.value('name') ?? preset?.campaign_name ?? 'Ad-hoc campaign',
    countries: countries.length > 0 ? countries : preset?.countries,
    cities: cities.length > 0 ? cities : preset?.cities,
    queries: queries.length > 0 ? queries : preset?.queries,
    verticals: verticals.length > 0 ? verticals : preset?.verticals,
    sources: sources.length > 0 ? sources : preset?.sources,
    exclude: excludes.length > 0 ? excludes : preset?.exclude,
    employees_min: args.number('min-employees') ?? preset?.employees_min ?? null,
    employees_max: args.number('max-employees') ?? preset?.employees_max ?? null,
    target_accounts: args.number('target') ?? preset?.target_accounts ?? 200,
    contacts_per_company: args.number('contacts') ?? 3,
    dry_run: args.flag('dry-run'),
  });

  const store = await getStore();

  log.info(`Campaign: ${criteria.campaign_name}`);
  log.info(
    `Countries: ${criteria.countries.join(', ') || 'any'} | target ${criteria.target_accounts} accounts` +
      (criteria.dry_run ? ' | DRY RUN (fixtures)' : ''),
  );

  // A CSV list is merged into discovery, then goes through the same enrichment,
  // scoring and dedupe path as anything found via an API.
  let seedCompanies: DiscoveredCompany[] = [];
  const importPath = args.value('import');
  if (importPath) {
    const imported = await loadCompanyListFile(importPath, {
      source: 'directory_import',
      defaultCountry: criteria.countries[0] ?? null,
      sourceUrl: importPath,
    });
    const { unique, removed } = dedupeBatch(imported);
    seedCompanies = unique;
    log.info(`Imported ${unique.length} companies from ${importPath} (${removed} duplicates in file)`);
  }

  const started = Date.now();
  const result = await runCampaign({
    criteria,
    store,
    seedCompanies,
    onProgress: (done, total, name) => {
      if (done % 10 === 0 || done === total) {
        log.info(`  [${done}/${total}] ${name}`);
      }
    },
  });

  const seconds = Math.round((Date.now() - started) / 1000);
  const run = result.run;

  log.info('');
  log.info(`Run ${run.run_ref} finished in ${seconds}s`);
  log.info(`  Companies found      ${run.companies_found}`);
  log.info(`  Duplicates collapsed ${run.duplicates_removed}`);
  log.info(`  Qualified            ${run.companies_qualified}`);
  log.info(`  Sent to review       ${run.sent_to_review}`);
  log.info(`  Rejected             ${run.rejected}`);
  log.info(`  Contacts found       ${run.contacts_found}`);
  log.info(`  New leads            ${result.newLeads.length}`);
  log.info(`  Updated leads        ${result.updatedLeads.length}`);

  if (!args.flag('no-export')) {
    const exported = await exportWorkbook(store);
    await store.updateRun(run.id, { export_filename: exported.filename });
    await store.flush();
    log.info('');
    log.info(`Workbook: ${exported.path} (${exported.sheetCount} sheets, ${exported.rowCount} rows)`);
  }
}

main().catch((err) => {
  log.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exitCode = 1;
});
