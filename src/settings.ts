export interface Settings {
  lat: number | null;
  lon: number | null;
  observerAltM: number;
  facing: number;
  coneWidth: number;
  maxDistKm: number;
  minElev: number;
  refreshS: number;
}

export const DEFAULTS: Settings = {
  lat: null,
  lon: null,
  observerAltM: 0,
  facing: 0,
  coneWidth: 90,
  maxDistKm: 50,
  minElev: 0,
  refreshS: 30,
};

/** adsb.lol rate-limits aggressive polling; never go faster than this. */
export const MIN_REFRESH_S = 15;

const KEY = "flight-window:settings";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s: Settings = { ...DEFAULTS, ...JSON.parse(raw) };
      // Older saves defaulted to 10 s, which got rate-limited.
      if (s.refreshS < MIN_REFRESH_S) s.refreshS = DEFAULTS.refreshS;
      return s;
    }
  } catch {
    // Storage unavailable or corrupt; fall back to defaults.
  }
  return { ...DEFAULTS };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Not fatal: settings just won't persist.
  }
}

const LIMITS: Record<keyof Settings, [number, number]> = {
  lat: [-90, 90],
  lon: [-180, 180],
  observerAltM: [-500, 9000],
  facing: [0, 360],
  coneWidth: [1, 360],
  maxDistKm: [1, 460],
  minElev: [-10, 89],
  refreshS: [MIN_REFRESH_S, 600],
};

/**
 * Bind every `<input name="...">` inside the form to a settings key.
 * Calls `onChange` with the updated settings and the key that changed.
 */
export function bindForm(
  form: HTMLFormElement,
  settings: Settings,
  onChange: (s: Settings, key: keyof Settings) => void,
): (s: Settings) => void {
  const inputs = Array.from(form.querySelectorAll<HTMLInputElement>("input[name]"));

  const fill = (s: Settings) => {
    for (const input of inputs) {
      const v = s[input.name as keyof Settings];
      if (document.activeElement !== input) input.value = v == null ? "" : String(v);
    }
  };
  fill(settings);

  form.addEventListener("input", (e) => {
    const input = e.target as HTMLInputElement;
    const key = input.name as keyof Settings;
    if (!(key in LIMITS) || input.value.trim() === "") return;
    const n = Number(input.value);
    const [min, max] = LIMITS[key];
    if (!Number.isFinite(n) || n < min || n > max) return;
    settings[key] = (key === "facing" ? n % 360 : n) as never;
    // Keep paired controls (e.g. facing slider + number box) in sync.
    for (const other of inputs) if (other !== input && other.name === key) other.value = String(n);
    saveSettings(settings);
    onChange(settings, key);
  });
  form.addEventListener("submit", (e) => e.preventDefault());

  return fill;
}
