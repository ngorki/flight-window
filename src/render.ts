import { extrapolate, type Aircraft } from "./api";
import { airportCode, getRoute, type RouteInfo } from "./routes";
import { compassLabel, normalize360, project, type Projection, type ViewParams } from "./geo";

/** Seconds ahead used to work out which way a plane is moving on screen. */
const HEADING_LOOKAHEAD_MS = 20_000;

export interface Visible extends Aircraft, Projection {
  /** Unit vector of on-screen motion: right/left (rel°) and up/down (elev°). */
  motion: { dRel: number; dElev: number } | null;
}

/** Extrapolate to `now`, keep what's inside the view, sorted left to right. */
export function buildScene(aircraft: Aircraft[], view: ViewParams, now: number): Visible[] {
  const out: Visible[] = [];
  for (const raw of aircraft) {
    const ac = extrapolate(raw, now);
    const p = project(view, ac);
    if (!p.visible) continue;
    let motion: Visible["motion"] = null;
    if (ac.speedKt && ac.track != null) {
      const ahead = project(view, extrapolate(raw, now + HEADING_LOOKAHEAD_MS));
      motion = { dRel: ahead.rel - p.rel, dElev: ahead.elev - p.elev };
    }
    out.push({ ...ac, ...p, motion });
  }
  return out.sort((a, b) => a.rel - b.rel);
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const label = (ac: Aircraft) => ac.callsign || ac.reg || ac.hex.toUpperCase();

const PLANE_PATH =
  "M11,0 C11,-1.2 10,-1.6 8,-1.6 L3,-1.6 L-2,-9 L-4.5,-9 L-1.5,-1.6 L-7,-1.6 L-9.5,-4.5 L-11,-4.5 L-9.5,0 " +
  "L-11,4.5 L-9.5,4.5 L-7,1.6 L-1.5,1.6 L-4.5,9 L-2,9 L3,1.6 L8,1.6 C10,1.6 11,1.2 11,0 Z";

export function renderStrip(
  host: HTMLElement,
  scene: Visible[],
  view: ViewParams,
  highlighted: string | null,
  message: string | null,
): void {
  const W = Math.max(280, host.clientWidth);
  const H = Math.round(Math.min(420, Math.max(220, W * 0.42)));
  const m = { top: 14, right: 14, bottom: 30, left: 34 };
  const half = view.coneWidth / 2;

  const maxElev = scene.reduce((mx, a) => Math.max(mx, a.elev), 0);
  const elevTop = Math.min(90, Math.max(30, Math.ceil((maxElev + 6) / 10) * 10));
  const elevBot = Math.min(0, Math.floor(view.minElev));
  const x = (rel: number) => m.left + ((rel + half) / view.coneWidth) * (W - m.left - m.right);
  const y = (elev: number) => m.top + ((elevTop - elev) / (elevTop - elevBot)) * (H - m.top - m.bottom);

  const parts: string[] = [];
  parts.push(`<rect class="sky" x="${m.left}" y="${m.top}" width="${W - m.left - m.right}" height="${y(0) - m.top}" rx="6"/>`);
  if (elevBot < 0) {
    parts.push(`<rect class="ground" x="${m.left}" y="${y(0)}" width="${W - m.left - m.right}" height="${y(elevBot) - y(0)}"/>`);
  }

  // Elevation grid
  const elevStep = elevTop > 60 ? 15 : 10;
  for (let e = 0; e <= elevTop; e += elevStep) {
    parts.push(`<line class="${e === 0 ? "horizon" : "grid"}" x1="${m.left}" x2="${W - m.right}" y1="${y(e)}" y2="${y(e)}"/>`);
    parts.push(`<text class="axis" x="${m.left - 6}" y="${y(e) + 4}" text-anchor="end">${e}°</text>`);
  }

  // Compass ticks along the bottom
  const pxPerDeg = (W - m.left - m.right) / view.coneWidth;
  const bStep = [5, 10, 15, 30, 45, 90].find((s) => s * pxPerDeg >= 55) ?? 90;
  for (let b = Math.ceil((view.facing - half) / bStep) * bStep; b <= view.facing + half + 1e-9; b += bStep) {
    const xb = x(b - view.facing);
    const deg = Math.round(normalize360(b));
    const text = deg % 45 === 0 ? `${compassLabel(deg)} ${deg}°` : `${deg}°`;
    parts.push(`<line class="tick" x1="${xb}" x2="${xb}" y1="${y(elevBot)}" y2="${y(elevBot) + 5}"/>`);
    const anchor = xb < m.left + 30 ? "start" : xb > W - m.right - 30 ? "end" : "middle";
    parts.push(`<text class="axis${deg % 45 === 0 ? " major" : ""}" x="${xb}" y="${H - 8}" text-anchor="${anchor}">${text}</text>`);
  }

  // Nudge callsign labels up or down so neighbours don't overlap (scene is already left-to-right).
  const labelDy = new Map<string, number>();
  const placed: { x1: number; x2: number; y1: number; y2: number }[] = [];
  for (const ac of scene) {
    const cx = x(ac.rel);
    const cy = y(ac.elev);
    const w = label(ac).length * 7.2;
    const flip = cx > W - 90;
    const x1 = flip ? cx - 14 - w : cx + 14;
    for (const dy of [0, -15, 15, -30, 30, -45, 45]) {
      const box = { x1, x2: x1 + w, y1: cy - 8 + dy - 11, y2: cy - 8 + dy + 3 };
      if (!placed.some((p) => box.x1 < p.x2 && box.x2 > p.x1 && box.y1 < p.y2 && box.y2 > p.y1) || dy === 45) {
        placed.push(box);
        labelDy.set(ac.hex, dy);
        break;
      }
    }
  }

  // Aircraft, far ones first so near ones draw on top
  for (const ac of [...scene].sort((a, b) => b.distKm - a.distKm)) {
    const cx = x(ac.rel);
    const cy = y(ac.elev);
    const scale = Math.min(1.5, Math.max(0.6, 1.5 - ac.distKm / view.maxDistKm)) * (W < 500 ? 0.7 : 1);
    const angle = ac.motion
      ? (Math.atan2(-ac.motion.dElev * (H / (elevTop - elevBot)), ac.motion.dRel * (W / view.coneWidth)) * 180) / Math.PI
      : 0;
    const hl = ac.hex === highlighted ? " hl" : "";
    const flipLabel = cx > W - 90;
    parts.push(
      `<g class="ac${hl}" data-hex="${ac.hex}" transform="translate(${cx.toFixed(1)},${cy.toFixed(1)})">` +
        `<title>${esc(label(ac) + routeText(ac))} · ${Math.round(ac.distKm)} km · ${Math.round(ac.altM / 0.3048).toLocaleString()} ft</title>` +
        `<circle class="hit" r="16"/>` +
        (ac.motion
          ? `<path class="plane" d="${PLANE_PATH}" transform="rotate(${angle.toFixed(1)}) scale(${scale.toFixed(2)})"/>`
          : `<circle class="plane" r="${(4 * scale).toFixed(1)}"/>`) +
        `<text class="cs" x="${flipLabel ? -14 : 14}" y="${-8 + (labelDy.get(ac.hex) ?? 0)}" text-anchor="${flipLabel ? "end" : "start"}">${esc(label(ac))}</text>` +
        `</g>`,
    );
  }

  if (message) {
    parts.push(`<text class="msg" x="${W / 2}" y="${(m.top + y(0)) / 2}" text-anchor="middle">${esc(message)}</text>`);
  }

  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="View out the window">${parts.join("")}</svg>`;
}

function routeCell(route: RouteInfo | null | undefined): string {
  if (route === undefined) return `<span class="muted">…</span>`;
  if (route === null) return `<span class="muted">–</span>`;
  const { origin: o, destination: d } = route;
  let title = `${o.name}${o.city ? ` (${o.city})` : ""} → ${d.name}${d.city ? ` (${d.city})` : ""}`;
  if (route.allLegs.split("-").length > 2) title += `\nFlight number routing: ${route.allLegs}`;
  if (!route.confident) title += "\nUnverified: doesn't match the plane's position or heading";
  const text = `${esc(airportCode(o))} → ${esc(airportCode(d))}${route.confident ? "" : "?"}`;
  return `<span class="${route.confident ? "" : "muted"}" title="${esc(title)}">${text}</span>`;
}

/** " · BZN → ATL" for tooltips, or empty when unknown. */
function routeText(ac: Aircraft): string {
  const r = getRoute(ac);
  return r ? ` · ${airportCode(r.origin)} → ${airportCode(r.destination)}${r.confident ? "" : "?"}` : "";
}

export function renderList(host: HTMLElement, scene: Visible[], highlighted: string | null): void {
  if (scene.length === 0) {
    host.innerHTML = "";
    return;
  }
  const rows = scene
    .map((ac, i) => {
      const hl = ac.hex === highlighted ? ` class="hl"` : "";
      const altFt = Math.round(ac.altM / 0.3048 / 100) * 100;
      return (
        `<tr data-hex="${ac.hex}"${hl}>` +
        `<td class="num">${i + 1}</td>` +
        `<td class="cs"><a href="https://globe.adsb.lol/?icao=${ac.hex}" target="_blank" rel="noopener">${esc(label(ac))}</a></td>` +
        `<td class="route">${routeCell(getRoute(ac))}</td>` +
        `<td class="num">${altFt.toLocaleString()}</td>` +
        `<td class="num">${ac.distKm.toFixed(1)}</td>` +
        `<td class="num">${Math.round(ac.bearing)}° ${compassLabel(ac.bearing)}</td>` +
        `<td class="num">${ac.elev.toFixed(1)}°</td>` +
        `<td class="num">${ac.speedKt != null ? Math.round(ac.speedKt) : "–"}</td>` +
        `</tr>`
      );
    })
    .join("");
  host.innerHTML =
    `<table><thead><tr><th class="num">#</th><th>Flight</th><th>From → To</th>` +
    `<th class="num">Alt ft</th><th class="num">Dist km</th><th class="num">Bearing</th>` +
    `<th class="num">Elev</th><th class="num">Speed kt</th></tr></thead><tbody>${rows}</tbody></table>`;
}
