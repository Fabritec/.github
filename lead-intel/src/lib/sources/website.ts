/**
 * Website reader. Fetches the homepage plus the handful of pages that actually
 * carry qualification evidence (capabilities, facilities, projects, quality),
 * strips them to text and hands them to the enrichment layer.
 *
 * Deliberately shallow: two levels, a handful of pages, a hard character budget.
 * The goal is enough text to judge a fabricator, not a site mirror.
 */

import { config } from '../config.js';
import { log } from '../logger.js';
import { fetchWithTimeout, normaliseDomain } from '../util.js';

export interface FetchedPage {
  url: string;
  text: string;
}

/** Path fragments that tend to hold capability and process evidence. */
const PRIORITY_HINTS = [
  'capabilit',
  'facilit',
  'about',
  'services',
  'manufactur',
  'production',
  'fabricat',
  'plant',
  'workshop',
  'quality',
  'qa-qc',
  'projects',
  'portfolio',
  'products',
  'technolog',
  'equipment',
  'career',
  'jobs',
];

const SKIP_HINTS = [
  'privacy',
  'terms',
  'cookie',
  'login',
  'cart',
  'account',
  '/blog/',
  '/news/',
  'wp-content',
  'wp-login',
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
  '.zip',
  '.doc',
  'mailto:',
  'tel:',
  'javascript:',
];

export interface ReadSiteOptions {
  maxPages?: number;
  maxChars?: number;
}

export async function readSite(
  websiteUrl: string,
  options: ReadSiteOptions = {},
): Promise<FetchedPage[]> {
  const maxPages = options.maxPages ?? 5;
  const maxChars = options.maxChars ?? config.pipeline.maxSiteChars;

  const home = await fetchPage(websiteUrl);
  if (!home) return [];

  const pages: FetchedPage[] = [home.page];
  let used = home.page.text.length;

  const candidates = rankLinks(home.links, websiteUrl);
  for (const link of candidates) {
    if (pages.length >= maxPages || used >= maxChars) break;
    const result = await fetchPage(link);
    if (!result || result.page.text.length < 200) continue;
    const remaining = maxChars - used;
    const text = result.page.text.slice(0, remaining);
    pages.push({ url: result.page.url, text });
    used += text.length;
  }

  return pages;
}

async function fetchPage(url: string): Promise<{ page: FetchedPage; links: string[] } | null> {
  try {
    const res = await fetchWithTimeout(url, {
      headers: {
        'User-Agent': 'FabritecLeadIntel/0.1 (+https://fabritec.io; contact: sales@fabritec.io)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) {
      log.debug(`Site fetch ${url} → ${res.status}`);
      return null;
    }
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('html')) return null;

    const html = await res.text();
    const finalUrl = res.url || url;
    return {
      page: { url: finalUrl, text: htmlToText(html) },
      links: extractLinks(html, finalUrl),
    };
  } catch (err) {
    log.debug(`Site fetch failed ${url}: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/** Crude but dependency-free HTML → text. Good enough for brochure sites. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n')
    .trim();
}

function extractLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  const regex = /<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const href = match[1];
    if (!href) continue;
    try {
      links.push(new URL(href, baseUrl).toString());
    } catch {
      // Ignore unparseable hrefs.
    }
  }
  return links;
}

/** Keeps same-domain links, drops noise, and puts evidence-bearing pages first. */
function rankLinks(links: string[], baseUrl: string): string[] {
  const baseDomain = normaliseDomain(baseUrl);
  if (!baseDomain) return [];

  const seen = new Set<string>();
  const scored: { url: string; score: number }[] = [];

  for (const link of links) {
    const clean = link.split('#')[0]!;
    if (seen.has(clean)) continue;
    seen.add(clean);

    if (normaliseDomain(clean) !== baseDomain) continue;

    const lower = clean.toLowerCase();
    if (SKIP_HINTS.some((h) => lower.includes(h))) continue;
    if (lower === baseUrl.toLowerCase()) continue;

    const hitIndex = PRIORITY_HINTS.findIndex((h) => lower.includes(h));
    if (hitIndex === -1) continue;

    // Earlier hints are stronger signals; shallower paths beat deeper ones.
    const depth = new URL(clean).pathname.split('/').filter(Boolean).length;
    scored.push({ url: clean, score: (PRIORITY_HINTS.length - hitIndex) * 10 - depth });
  }

  return scored.sort((a, b) => b.score - a.score).map((s) => s.url);
}
