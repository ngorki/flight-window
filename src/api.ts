import { destinationPoint, type LatLon } from "./geo";

const FT_TO_M = 0.3048;
const KT_TO_KMH = 1.852;
const MAX_RADIUS_NM = 250;
/** Don't extrapolate positions further than this past the last report. */
const MAX_EXTRAPOLATE_S = 60;
/** Per source; a slow source falls through to the next one. */
const FETCH_TIMEOUT_MS = 12_000;

export interface Aircraft {
  hex: string;
  callsign: string;
  lat: number;
  lon: number;
  altM: number;
  speedKt: number | null;
  track: number | null;
  vertRateFpm: number | null;
  type: string;
  reg: string;
  /** Wall-clock ms when this position was reported (fetch time minus seen_pos). */
  reportedAt: number;
}

interface RawAircraft {
  hex: string;
  flight?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | "ground";
  alt_geom?: number;
  gs?: number;
  track?: number;
  baro_rate?: number;
  geom_rate?: number;
  t?: string;
  r?: string;
  seen_pos?: number;
}

interface Source {
  name: string;
  url: (lat: string, lon: string, radiusNm: number) => string;
}

/** Both serve readsb-format JSON; requests go through the Vite proxy (neither sends CORS headers). */
const SOURCES: Source[] = [
  { name: "adsb.lol", url: (lat, lon, nm) => `/adsb/v2/point/${lat}/${lon}/${nm}` },
  { name: "adsb.fi", url: (lat, lon, nm) => `/adsbfi/api/v2/lat/${lat}/lon/${lon}/dist/${nm}` },
];
/** Index of the source that last worked; tried first next time. */
let preferred = 0;

/** Fetch from the preferred source, falling back to the others if it fails. Returns which source answered. */
export async function fetchAircraft(
  center: LatLon,
  radiusKm: number,
  signal?: AbortSignal,
): Promise<{ aircraft: Aircraft[]; source: string }> {
  const radiusNm = Math.min(MAX_RADIUS_NM, Math.ceil(radiusKm / KT_TO_KMH));
  const errors: string[] = [];
  for (let k = 0; k < SOURCES.length; k++) {
    const i = (preferred + k) % SOURCES.length;
    const src = SOURCES[i];
    try {
      const aircraft = await fetchFrom(src, src.url(center.lat.toFixed(4), center.lon.toFixed(4), radiusNm), signal);
      preferred = i;
      return { aircraft, source: src.name };
    } catch (err) {
      if (signal?.aborted) throw err;
      errors.push((err as Error).message);
    }
  }
  throw new Error(errors.join("; "));
}

async function fetchFrom(src: Source, url: string, signal?: AbortSignal): Promise<Aircraft[]> {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const res = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout }).catch((err) => {
    if (timeout.aborted) throw new Error(`${src.name} didn't respond in time`);
    throw err;
  });
  if (res.status === 420 || res.status === 429) throw new Error(`${src.name} is rate-limiting requests`);
  if (!res.ok) throw new Error(`${src.name} responded ${res.status}`);
  if (!res.headers.get("content-type")?.includes("json")) throw new Error(`${src.name} returned an unexpected response`);
  const body = (await res.json()) as { ac?: RawAircraft[]; aircraft?: RawAircraft[] };
  const now = Date.now();
  return (body.ac ?? body.aircraft ?? []).flatMap((a) => {
    if (a.lat == null || a.lon == null || a.alt_baro === "ground") return [];
    const altFt = a.alt_geom ?? a.alt_baro;
    if (typeof altFt !== "number") return [];
    return [
      {
        hex: a.hex,
        callsign: a.flight?.trim() ?? "",
        lat: a.lat,
        lon: a.lon,
        altM: altFt * FT_TO_M,
        speedKt: a.gs ?? null,
        track: a.track ?? null,
        vertRateFpm: a.geom_rate ?? a.baro_rate ?? null,
        type: a.t ?? "",
        reg: a.r ?? "",
        reportedAt: now - (a.seen_pos ?? 0) * 1000,
      },
    ];
  });
}

/** Dead-reckon an aircraft to time `at` (ms) using its speed, track and vertical rate. */
export function extrapolate(ac: Aircraft, at: number): Aircraft {
  if (ac.speedKt == null || ac.track == null) return ac;
  const dt = Math.min(MAX_EXTRAPOLATE_S, Math.max(0, (at - ac.reportedAt) / 1000));
  const pos = destinationPoint(ac, ac.track, (ac.speedKt * KT_TO_KMH * dt) / 3600);
  const climbM = ((ac.vertRateFpm ?? 0) * FT_TO_M * dt) / 60;
  return { ...ac, ...pos, altM: Math.max(0, ac.altM + climbM) };
}
