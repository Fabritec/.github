/**
 * Google Places (New) Text Search, run as a grid: every query × every city.
 *
 * This is the workhorse for MENA fabricators, where the big B2B databases have
 * thin coverage. It returns name, site, phone and address cheaply; everything
 * else is someone else's job.
 */

import { config } from '../config.js';
import { log } from '../logger.js';
import type { DiscoveredCompany } from '../types.js';
import { fetchWithTimeout, normaliseDomain, normaliseUrl, uniqueBy, withRetry } from '../util.js';

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.websiteUri',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.primaryTypeDisplayName',
  'places.types',
  'places.addressComponents',
  'nextPageToken',
].join(',');

interface PlacesResponse {
  places?: PlaceRecord[];
  nextPageToken?: string;
}

interface PlaceRecord {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  primaryTypeDisplayName?: { text?: string };
  types?: string[];
  addressComponents?: { longText?: string; shortText?: string; types?: string[] }[];
}

export interface PlacesSearchParams {
  queries: string[];
  cities: string[];
  /** Hard cap on results per query×city cell; the API pages 20 at a time. */
  maxPerCell?: number;
}

export function isGooglePlacesConfigured(): boolean {
  return config.googlePlaces.apiKey !== null;
}

/**
 * Runs the full grid. One cell failing (rate limit, bad city string) doesn't
 * abort the run — discovery is best-effort by design.
 */
export async function searchPlaces(params: PlacesSearchParams): Promise<DiscoveredCompany[]> {
  if (!isGooglePlacesConfigured()) {
    log.warn('Google Places skipped: GOOGLE_PLACES_API_KEY not set');
    return [];
  }

  const maxPerCell = params.maxPerCell ?? 40;
  const found: DiscoveredCompany[] = [];

  for (const query of params.queries) {
    for (const city of params.cities) {
      const textQuery = `${query} in ${city}`;
      try {
        const cell = await searchCell(textQuery, maxPerCell);
        log.debug(`Places: "${textQuery}" → ${cell.length}`);
        found.push(...cell);
      } catch (err) {
        log.warn(
          `Places cell failed ("${textQuery}"): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // Same factory shows up under several queries; keep the first sighting.
  return uniqueBy(found, (c) => c.provider_company_id ?? c.domain ?? c.name.toLowerCase());
}

async function searchCell(textQuery: string, maxResults: number): Promise<DiscoveredCompany[]> {
  const out: DiscoveredCompany[] = [];
  let pageToken: string | undefined;

  while (out.length < maxResults) {
    const body: Record<string, unknown> = { textQuery, pageSize: 20 };
    if (pageToken) body.pageToken = pageToken;

    const response = await withRetry(async () => {
      const res = await fetchWithTimeout(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': config.googlePlaces.apiKey!,
          'X-Goog-FieldMask': FIELD_MASK,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(`Places ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      return (await res.json()) as PlacesResponse;
    });

    for (const place of response.places ?? []) {
      out.push(toDiscovered(place, textQuery));
      if (out.length >= maxResults) break;
    }

    if (!response.nextPageToken) break;
    pageToken = response.nextPageToken;
  }

  return out;
}

function componentOf(place: PlaceRecord, type: string): string | null {
  const match = place.addressComponents?.find((c) => c.types?.includes(type));
  return match?.longText ?? match?.shortText ?? null;
}

function toDiscovered(place: PlaceRecord, query: string): DiscoveredCompany {
  const website = normaliseUrl(place.websiteUri ?? null);
  return {
    name: place.displayName?.text?.trim() ?? 'Unknown',
    website,
    domain: normaliseDomain(website),
    phone: place.internationalPhoneNumber ?? place.nationalPhoneNumber ?? null,
    address: place.formattedAddress ?? null,
    city:
      componentOf(place, 'locality') ??
      componentOf(place, 'administrative_area_level_2') ??
      componentOf(place, 'administrative_area_level_1'),
    country: componentOf(place, 'country'),
    source: 'google_places',
    source_url: place.id ? `https://www.google.com/maps/place/?q=place_id:${place.id}` : null,
    provider_company_id: place.id ?? null,
    raw: {
      query,
      types: place.types ?? [],
      primary_type: place.primaryTypeDisplayName?.text ?? null,
    },
  };
}

/**
 * The default MENA grid described in the sourcing plan. Campaigns can override
 * either axis; this is just the sensible starting point.
 */
export const DEFAULT_QUERIES = [
  'steel fabrication',
  'structural steel fabricator',
  'precast concrete factory',
  'aluminium fabrication',
  'PEB manufacturer',
  'pre-engineered building manufacturer',
  'metal works factory',
  'sheet metal fabrication',
];

export const DEFAULT_CITIES = [
  'Cairo, Egypt',
  'Alexandria, Egypt',
  '10th of Ramadan City, Egypt',
  'Riyadh, Saudi Arabia',
  'Dammam, Saudi Arabia',
  'Jubail, Saudi Arabia',
  'Jeddah, Saudi Arabia',
  'Sharjah, United Arab Emirates',
  'Dubai, United Arab Emirates',
  'Abu Dhabi, United Arab Emirates',
  'Doha, Qatar',
];
