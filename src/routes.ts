/**
 * Departure/arrival lookups via adsb.im's routeset API (the one globe.adsb.lol uses).
 *
 * Airlines reuse a flight number for several legs (e.g. DAL406 = ATL-BZN-ATL), so a
 * callsign alone doesn't say which leg is being flown. We fetch the full multi-leg
 * routing once per callsign, then pick the leg that fits the plane's live position
 * and heading. Routes that don't fit are shown as unverified.
 */
import { angleDiff, haversineKm, initialBearing, pathOffset, type LatLon } from "./geo";

export interface Airport extends LatLon {
  iata: string;
  icao: string;
  name: string;
  city: string;
}

export interface RouteInfo {
  origin: Airport;
  destination: Airport;
  /** False when the plane's position or heading doesn't match any leg well. */
  confident: boolean;
  /** Full routing for the flight number, e.g. "ATL-BZN-ATL". */
  allLegs: string;
}

interface CacheEntry {
  airports: Airport[];
  plausible: boolean;
  at: number;
}

export interface Plane extends LatLon {
  callsign: string;
  track: number | null;
}

const API_URL = "https://adsb.im/api/0/routeset";
const STORAGE_KEY = "flight-window:routes-v2";
const TTL_MS = 6 * 60 * 60 * 1000;
const MISS_TTL_MS = 60 * 60 * 1000;
const BATCH_DELAY_MS = 1500;
const BATCH_SIZE = 50;
const RETRY_MS = 60_000;
const FETCH_TIMEOUT_MS = 15_000;
/** Within this distance of the destination, planes manoeuvre, so heading isn't checked. */
const APPROACH_KM = 80;

const cache = new Map<string, CacheEntry>(loadCache());
const pending = new Map<string, Plane>();
const retryAfter = new Map<string, number>();
let batchTimer: number | undefined;
let onUpdate: () => void = () => {};

function loadCache(): [string, CacheEntry][] {
  try {
    localStorage.removeItem("flight-window:routes"); // adsbdb cache from an earlier version
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const now = Date.now();
    return (JSON.parse(raw) as [string, CacheEntry][]).filter(([, e]) => !isExpired(e, now));
  } catch {
    return [];
  }
}

function saveCache(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...cache]));
  } catch {
    // Not fatal: routes just get looked up again next visit.
  }
}

function isExpired(e: CacheEntry, now: number): boolean {
  return now - e.at > (e.airports.length >= 2 ? TTL_MS : MISS_TTL_MS);
}

/** Called whenever a lookup finishes, so the UI can redraw. */
export function onRoutesUpdated(cb: () => void): void {
  onUpdate = cb;
}

/** Route for a plane: RouteInfo, `null` if unknown, or `undefined` while pending. */
export function getRoute(plane: Plane): RouteInfo | null | undefined {
  if (!plane.callsign) return null;
  const e = cache.get(plane.callsign);
  if (e && !isExpired(e, Date.now())) return pickLeg(e, plane);
  if ((retryAfter.get(plane.callsign) ?? 0) <= Date.now()) {
    pending.set(plane.callsign, plane);
    batchTimer ??= window.setTimeout(flush, BATCH_DELAY_MS);
  }
  return undefined;
}

async function flush(): Promise<void> {
  batchTimer = undefined;
  const batch = [...pending.values()].slice(0, BATCH_SIZE);
  for (const p of batch) pending.delete(p.callsign);
  if (batch.length === 0) return;
  try {
    const results = await lookup(batch);
    const now = Date.now();
    for (const p of batch) cache.set(p.callsign, results.get(p.callsign) ?? { airports: [], plausible: false, at: now });
    saveCache();
    onUpdate();
  } catch {
    // Network error or rate limit: try these callsigns again later rather than every redraw.
    for (const p of batch) retryAfter.set(p.callsign, Date.now() + RETRY_MS);
  }
  if (pending.size) batchTimer = window.setTimeout(flush, BATCH_DELAY_MS);
}

interface RawRoute {
  callsign: string;
  plausible?: boolean | number;
  _airports?: { iata?: string; icao?: string; name?: string; location?: string; lat: number; lon: number }[];
}

async function lookup(planes: Plane[]): Promise<Map<string, CacheEntry>> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ planes: planes.map((p) => ({ callsign: p.callsign, lat: p.lat, lng: p.lon })) }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`adsb.im responded ${res.status}`);
  const body = (await res.json()) as RawRoute[];
  const now = Date.now();
  return new Map(
    body.map((r) => [
      r.callsign,
      {
        airports: (r._airports ?? []).map((a) => ({
          iata: a.iata ?? "",
          icao: a.icao ?? "",
          name: a.name ?? "",
          city: a.location ?? "",
          lat: a.lat,
          lon: a.lon,
        })),
        plausible: Boolean(r.plausible),
        at: now,
      },
    ]),
  );
}

/** Choose the leg of a multi-leg routing that best matches where the plane is and where it's heading. */
export function pickLeg(e: Pick<CacheEntry, "airports" | "plausible">, plane: Plane): RouteInfo | null {
  const ap = e.airports;
  if (ap.length < 2) return null;
  let best: { score: number; i: number; fits: boolean; heading: boolean } | null = null;
  for (let i = 0; i < ap.length - 1; i++) {
    const [a, b] = [ap[i], ap[i + 1]];
    const off = pathOffset(plane, a, b);
    const fits =
      off.crossKm <= Math.max(100, 0.15 * off.lengthKm) && off.alongKm >= -100 && off.alongKm <= off.lengthKm + 100;
    const heading =
      plane.track == null || haversineKm(plane, b) < APPROACH_KM || angleDiff(plane.track, initialBearing(plane, b)) <= 90;
    const score = off.crossKm + (fits ? 0 : 2000) + (heading ? 0 : 5000);
    if (!best || score < best.score) best = { score, i, fits, heading };
  }
  const { i, fits, heading } = best!;
  return {
    origin: ap[i],
    destination: ap[i + 1],
    confident: e.plausible && fits && heading,
    allLegs: ap.map(airportCode).join("-"),
  };
}

/** Short code for display: IATA if it has one, else ICAO. */
export const airportCode = (a: Pick<Airport, "iata" | "icao">) => a.iata || a.icao || "?";
