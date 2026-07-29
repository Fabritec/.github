/**
 * The enrichment call. Forced tool use gives us schema-valid JSON without prose,
 * and a single retry covers the occasional malformed argument object.
 */

import Anthropic from '@anthropic-ai/sdk';
import { config, hasAnthropic } from '../config.js';
import { log } from '../logger.js';
import type { CompanyFacts } from '../types.js';
import { buildEnrichmentPrompt, ENRICHMENT_SYSTEM_PROMPT, type EnrichmentContext } from './prompts.js';
import { COMPANY_FACTS_TOOL_SCHEMA, companyFactsSchema, emptyFacts } from './schema.js';

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    if (!config.anthropic.apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set');
    }
    client = new Anthropic({ apiKey: config.anthropic.apiKey });
  }
  return client;
}

const TOOL = {
  name: 'record_company_facts',
  description:
    'Record the extracted, evidence-backed facts about a manufacturing company. Facts only — no scores, ratings or recommendations about whether to pursue the company.',
  input_schema: COMPANY_FACTS_TOOL_SCHEMA,
};

export interface EnrichmentResult {
  facts: CompanyFacts;
  ok: boolean;
  error: string | null;
  usage: { input_tokens: number; output_tokens: number } | null;
}

export async function enrichCompany(ctx: EnrichmentContext): Promise<EnrichmentResult> {
  if (!hasAnthropic()) {
    return {
      facts: emptyFacts('Enrichment skipped: ANTHROPIC_API_KEY not configured.'),
      ok: false,
      error: 'ANTHROPIC_API_KEY not configured',
      usage: null,
    };
  }

  const prompt = buildEnrichmentPrompt(ctx);

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await getClient().messages.create({
        model: config.anthropic.model,
        max_tokens: config.anthropic.maxTokens,
        system: ENRICHMENT_SYSTEM_PROMPT,
        tools: [TOOL],
        tool_choice: { type: 'tool', name: TOOL.name },
        messages: [{ role: 'user', content: prompt }],
      });

      const block = response.content.find((c) => c.type === 'tool_use');
      if (!block || block.type !== 'tool_use') {
        throw new Error('Model returned no tool_use block');
      }

      const parsed = companyFactsSchema.safeParse(block.input);
      if (!parsed.success) {
        throw new Error(`Schema validation failed: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
      }

      return {
        facts: normalise(parsed.data),
        ok: true,
        error: null,
        usage: {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (attempt === 2) {
        log.warn(`Enrichment failed for ${ctx.companyName}: ${message}`);
        return {
          facts: emptyFacts(`Enrichment failed: ${message}`),
          ok: false,
          error: message,
          usage: null,
        };
      }
      log.debug(`Enrichment attempt ${attempt} failed for ${ctx.companyName}, retrying: ${message}`);
      await sleep(750 * attempt);
    }
  }

  return {
    facts: emptyFacts('Enrichment failed after retries.'),
    ok: false,
    error: 'exhausted retries',
    usage: null,
  };
}

/** Trims noise the model sometimes emits so downstream comparisons stay stable. */
function normalise(facts: CompanyFacts): CompanyFacts {
  const clean = (arr: string[]): string[] =>
    Array.from(new Set(arr.map((s) => s.trim()).filter((s) => s.length > 0)));

  return {
    ...facts,
    production_stages: clean(facts.production_stages),
    detailing_software: clean(facts.detailing_software),
    certifications: clean(facts.certifications),
    countries_of_operation: clean(facts.countries_of_operation),
    manual_tracking_signals: clean(facts.manual_tracking_signals),
    named_projects: clean(facts.named_projects),
    pain_signals: clean(facts.pain_signals),
    disqualifiers: clean(facts.disqualifiers),
    outreach_angle: facts.outreach_angle.trim(),
    reasoning: facts.reasoning.trim(),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
