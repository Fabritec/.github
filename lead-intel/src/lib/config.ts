/**
 * Environment configuration. Nothing here throws at import time — the pipeline
 * degrades to whatever credentials are actually present, so a run with only a
 * Google Places key still works (it just skips Apollo and Hunter).
 */

function str(name: string): string | null {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : null;
}

function num(name: string, fallback: number): number {
  const v = str(name);
  if (v === null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  anthropic: {
    apiKey: str('ANTHROPIC_API_KEY'),
    /**
     * Enrichment is high-volume and schema-constrained, so the default is the
     * mid-tier model. Override for a slower, more careful pass.
     */
    model: str('ANTHROPIC_MODEL') ?? 'claude-sonnet-5',
    maxTokens: num('ANTHROPIC_MAX_TOKENS', 4096),
  },
  supabase: {
    url: str('SUPABASE_URL'),
    serviceRoleKey: str('SUPABASE_SERVICE_ROLE_KEY'),
  },
  googlePlaces: {
    apiKey: str('GOOGLE_PLACES_API_KEY'),
  },
  apollo: {
    apiKey: str('APOLLO_API_KEY'),
  },
  hunter: {
    apiKey: str('HUNTER_API_KEY'),
  },
  googleSheets: {
    spreadsheetId: str('GOOGLE_SHEETS_SPREADSHEET_ID'),
    serviceAccountEmail: str('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
    // Stored with literal \n so it survives a single-line env var.
    privateKey: str('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY')?.replace(/\\n/g, '\n') ?? null,
  },
  storage: {
    /** 'supabase' | 'json'. Falls back to json when Supabase is unconfigured. */
    driver: str('LEAD_STORE_DRIVER'),
    jsonPath: str('LEAD_STORE_JSON_PATH') ?? '.data/store.json',
  },
  pipeline: {
    /** Parallel enrichment workers. Keep modest to stay inside rate limits. */
    concurrency: num('PIPELINE_CONCURRENCY', 4),
    /** Website fetch budget per company, in bytes of extracted text. */
    maxSiteChars: num('PIPELINE_MAX_SITE_CHARS', 24000),
    requestTimeoutMs: num('PIPELINE_REQUEST_TIMEOUT_MS', 20000),
  },
  export: {
    outDir: str('EXPORT_DIR') ?? 'exports',
  },
} as const;

export function resolveStoreDriver(): 'supabase' | 'json' {
  if (config.storage.driver === 'supabase') return 'supabase';
  if (config.storage.driver === 'json') return 'json';
  return config.supabase.url && config.supabase.serviceRoleKey ? 'supabase' : 'json';
}

export function hasAnthropic(): boolean {
  return config.anthropic.apiKey !== null;
}
