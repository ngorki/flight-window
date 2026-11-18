import "./style.css";
import { fetchAircraft, type Aircraft } from "./api";
import { compassLabel, type ViewParams } from "./geo";
import { buildScene, renderList, renderStrip } from "./render";
import { onRoutesUpdated } from "./routes";
import { bindForm, loadSettings, saveSettings, type Settings } from "./settings";

const MAX_BACKOFF_MS = 120_000;

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const form = $<HTMLFormElement>("#settings-form");
const details = $<HTMLDetailsElement>("#settings");
const stripEl = $("#strip");
const listEl = $("#list");
const statusEl = $("#status");
const summaryEl = $("#view-summary");
const errorEl = $("#error");
const locateBtn = $<HTMLButtonElement>("#locate");

const settings = loadSettings();
let aircraft: Aircraft[] = [];
let fetchedAt: number | null = null;
let source = "";
let loading = false;
let failures = 0;
let highlighted: string | null = null;
let pollTimer: number | undefined;
let refetchTimer: number | undefined;
let inflight: AbortController | null = null;

const hasLocation = (s: Settings) => s.lat != null && s.lon != null;

function viewParams(s: Settings): ViewParams {
  return {
    observer: { lat: s.lat ?? 0, lon: s.lon ?? 0 },
    observerAltM: s.observerAltM,
    facing: s.facing,
    coneWidth: s.coneWidth,
    maxDistKm: s.maxDistKm,
    minElev: s.minElev,
  };
}

function draw(): void {
  const view = viewParams(settings);
  summaryEl.textContent = `Facing ${Math.round(settings.facing)}° ${compassLabel(settings.facing)} · ${settings.coneWidth}° cone · ${settings.maxDistKm} km`;

  if (!hasLocation(settings)) {
    renderStrip(stripEl, [], view, null, "Set your location below to begin");
    renderList(listEl, [], null);
    statusEl.textContent = "";
    return;
  }

  const scene = buildScene(aircraft, view, Date.now());
  const message = fetchedAt == null ? (loading ? "Loading flights…" : null) : scene.length === 0 ? "No aircraft in view right now" : null;
  renderStrip(stripEl, scene, view, highlighted, message);
  renderList(listEl, scene, highlighted);

  if (fetchedAt != null) {
    const time = new Date(fetchedAt).toLocaleTimeString();
    statusEl.textContent = `${scene.length} in view of ${aircraft.length} nearby · ${source} · updated ${time}`;
  }
}

async function poll(): Promise<void> {
  window.clearTimeout(pollTimer);
  if (!hasLocation(settings)) return;
  if (document.hidden) {
    // Resume from the visibilitychange handler instead.
    return;
  }
  inflight?.abort();
  const ctrl = new AbortController();
  inflight = ctrl;
  loading = true;
  draw();
  try {
    ({ aircraft, source } = await fetchAircraft({ lat: settings.lat!, lon: settings.lon! }, settings.maxDistKm, ctrl.signal));
    fetchedAt = Date.now();
    failures = 0;
    errorEl.hidden = true;
  } catch (err) {
    if (ctrl.signal.aborted) return;
    failures++;
    errorEl.textContent = `Couldn't load flights: ${(err as Error).message}. Retrying…`;
    errorEl.hidden = false;
  } finally {
    if (inflight === ctrl) inflight = null;
    loading = false;
  }
  draw();
  const delay = Math.min(MAX_BACKOFF_MS, settings.refreshS * 1000 * 2 ** failures);
  pollTimer = window.setTimeout(poll, delay);
}

/** Debounced refetch for edits that change which aircraft the API returns. */
function scheduleRefetch(): void {
  window.clearTimeout(refetchTimer);
  refetchTimer = window.setTimeout(() => {
    aircraft = [];
    fetchedAt = null;
    poll();
  }, 600);
}

const fill = bindForm(form, settings, (_s, key) => {
  if (key === "lat" || key === "lon" || key === "maxDistKm") scheduleRefetch();
  else if (key === "refreshS") poll();
  draw();
});

locateBtn.addEventListener("click", () => {
  if (!navigator.geolocation) {
    errorEl.textContent = "This browser can't share its location. Enter latitude and longitude instead.";
    errorEl.hidden = false;
    return;
  }
  locateBtn.disabled = true;
  locateBtn.textContent = "Locating…";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      settings.lat = Number(pos.coords.latitude.toFixed(5));
      settings.lon = Number(pos.coords.longitude.toFixed(5));
      if (pos.coords.altitude != null) settings.observerAltM = Math.round(pos.coords.altitude);
      saveSettings(settings);
      fill(settings);
      locateBtn.disabled = false;
      locateBtn.textContent = "Use my location";
      scheduleRefetch();
      draw();
    },
    (err) => {
      errorEl.textContent = `Couldn't get your location: ${err.message}`;
      errorEl.hidden = false;
      locateBtn.disabled = false;
      locateBtn.textContent = "Use my location";
    },
    { enableHighAccuracy: true, timeout: 15_000 },
  );
});

// Hovering a plane highlights its row, and vice versa.
for (const el of [stripEl, listEl]) {
  el.addEventListener("mouseover", (e) => {
    const hex = (e.target as Element).closest<HTMLElement | SVGElement>("[data-hex]")?.dataset.hex ?? null;
    if (hex !== highlighted) {
      highlighted = hex;
      draw();
    }
  });
  el.addEventListener("mouseleave", () => {
    highlighted = null;
    draw();
  });
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && (fetchedAt == null || Date.now() - fetchedAt > settings.refreshS * 1000)) poll();
});
window.addEventListener("resize", draw);
onRoutesUpdated(draw);
window.setInterval(draw, 1000);

details.open = !hasLocation(settings);
draw();
poll();
