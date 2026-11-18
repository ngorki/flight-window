export const EARTH_RADIUS_KM = 6371;

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

export interface LatLon {
  lat: number;
  lon: number;
}

/** Normalize any angle to [0, 360). */
export function normalize360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Great-circle ground distance in km. */
export function haversineKm(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial great-circle bearing from a to b, degrees in [0, 360). */
export function initialBearing(a: LatLon, b: LatLon): number {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δλ = toRad(b.lon - a.lon);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return normalize360(toDeg(Math.atan2(y, x)));
}

/**
 * Bearing relative to the direction the window faces, in (-180, 180].
 * Negative = left of center, positive = right.
 */
export function relativeBearing(bearing: number, facing: number): number {
  const r = normalize360(bearing - facing);
  return r > 180 ? r - 360 : r;
}

/** Elevation angle in degrees above the horizon, with Earth-curvature drop. */
export function elevationAngle(distKm: number, altM: number, observerAltM: number): number {
  const dM = distKm * 1000;
  const drop = (dM * dM) / (2 * EARTH_RADIUS_KM * 1000);
  return toDeg(Math.atan2(altM - observerAltM - drop, dM));
}

export function inCone(rel: number, widthDeg: number): boolean {
  return Math.abs(rel) <= widthDeg / 2;
}

/** Move a point along a bearing by a distance (used for dead reckoning). */
export function destinationPoint(p: LatLon, bearingDeg: number, distKm: number): LatLon {
  const δ = distKm / EARTH_RADIUS_KM;
  const θ = toRad(bearingDeg);
  const φ1 = toRad(p.lat);
  const λ1 = toRad(p.lon);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 =
    λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: toDeg(φ2), lon: ((toDeg(λ2) + 540) % 360) - 180 };
}

/**
 * Position of p relative to the great-circle path a→b:
 * `crossKm` = distance off the path, `alongKm` = distance travelled from a along it
 * (negative if behind a), `lengthKm` = total a→b distance.
 */
export function pathOffset(p: LatLon, a: LatLon, b: LatLon): { crossKm: number; alongKm: number; lengthKm: number } {
  const d13 = haversineKm(a, p) / EARTH_RADIUS_KM;
  const θ13 = toRad(initialBearing(a, p));
  const θ12 = toRad(initialBearing(a, b));
  const dxt = Math.asin(Math.sin(d13) * Math.sin(θ13 - θ12));
  const dat = Math.acos(Math.min(1, Math.cos(d13) / Math.cos(dxt)));
  const sign = Math.cos(θ13 - θ12) < 0 ? -1 : 1;
  return {
    crossKm: Math.abs(dxt) * EARTH_RADIUS_KM,
    alongKm: sign * dat * EARTH_RADIUS_KM,
    lengthKm: haversineKm(a, b),
  };
}

/** Smallest absolute difference between two headings, 0–180. */
export function angleDiff(a: number, b: number): number {
  return Math.abs(relativeBearing(a, b));
}

export interface ViewParams {
  observer: LatLon;
  observerAltM: number;
  facing: number;
  coneWidth: number;
  maxDistKm: number;
  minElev: number;
}

export interface Projection {
  distKm: number;
  bearing: number;
  rel: number;
  elev: number;
  visible: boolean;
}

export function project(view: ViewParams, ac: LatLon & { altM: number }): Projection {
  const distKm = haversineKm(view.observer, ac);
  const bearing = initialBearing(view.observer, ac);
  const rel = relativeBearing(bearing, view.facing);
  const elev = elevationAngle(distKm, ac.altM, view.observerAltM);
  const visible = inCone(rel, view.coneWidth) && distKm <= view.maxDistKm && elev >= view.minElev;
  return { distKm, bearing, rel, elev, visible };
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export function compassLabel(deg: number): string {
  return COMPASS[Math.round(normalize360(deg) / 45) % 8];
}
