# Flight Window

See which planes are in front of your window right now.

Set your location, the compass direction your window faces, and how wide your view is. Flight Window shows the live aircraft inside that view cone, placed left to right and by height the way you'd see them looking out, with a list underneath.

## Features

- **Window view.** Each plane is drawn by its bearing (left to right) and elevation angle above the horizon, with Earth's curvature taken into account. Icons point the way the plane is moving on screen, and nearer planes are drawn larger.
- **Ordered list.** Callsign, departure → arrival airports, altitude, distance, bearing, elevation and speed, in the same left-to-right order. Hovering a plane highlights its row and the reverse.
- **Routes that match the flight.** Airlines reuse one flight number for several legs, so the app picks the leg that fits each plane's live position and heading. Routes that don't fit are dimmed and marked with `?`.
- **Smooth motion.** Positions refresh every 30 seconds by default, and planes move forward between updates using their speed, track and climb rate.
- **Filters.** Maximum distance, plus a minimum elevation angle to hide planes behind buildings or below the horizon.
- **Fallback feed.** If adsb.lol fails, the app switches to adsb.fi.
- **Light and dark themes**, and a layout that works on phones.

## Getting started

Requires Node.js 18 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:5173, expand **View settings**, and set:

| Setting | Meaning |
| --- | --- |
| Latitude / Longitude | Where you are. **Use my location** fills these from the browser. |
| Elevation | Your height above sea level in metres (e.g. a high-floor apartment). |
| Facing | Compass bearing your window faces: 0 = north, 90 = east, 180 = south, 270 = west. |
| Cone width | How many degrees of sky the window shows, edge to edge. |
| Max distance | Ignore aircraft further away than this. |
| Min elevation | Ignore aircraft lower than this angle above the horizon. |
| Refresh | Seconds between data updates (minimum 15). |

Settings are saved in your browser's local storage and never leave your device, apart from the coordinates sent to the flight data APIs.

### Finding your facing bearing

Stand at the window and use a phone compass app, or find your building on a map and measure the direction straight out from the window.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload and the API proxy |
| `npm test` | Unit tests (Vitest) for the geometry and route-leg logic |
| `npm run build` | Type-check and build static files into `dist/` |
| `npm run preview` | Serve the production build locally, with the API proxy |

## Deploying

adsb.lol and adsb.fi don't send CORS headers, so browsers can't call them directly. The app requests same-origin paths (`/adsb/…` and `/adsbfi/…`), and the host has to proxy those to the real APIs. A plain static host such as GitHub Pages will load the page but show no flights.

Configs for two hosts that can proxy with no server code are included:

- **Netlify:** `netlify.toml`. Import the repo in Netlify; the build settings and proxy rules are picked up automatically.
- **Vercel:** `vercel.json`. Import the repo in Vercel; it detects Vite and applies the rewrites.

To use another host, proxy these paths:

| Path | Proxies to |
| --- | --- |
| `/adsb/*` | `https://api.adsb.lol/*` |
| `/adsbfi/*` | `https://opendata.adsb.fi/*` |

Route lookups go straight from the browser to `https://adsb.im` (it allows cross-origin requests), so they need no proxy.

When the site is hosted, every visitor's requests reach the flight APIs from the host's servers, so a busy deployment can run into the providers' rate limits.

## How it works

```
src/
  geo.ts       Bearing, distance, elevation angle, view-cone and path geometry (pure functions)
  api.ts       Fetches aircraft from adsb.lol / adsb.fi and dead-reckons positions
  routes.ts    Route lookups via adsb.im, cached per callsign, with leg selection
  render.ts    Window strip (SVG) and the list
  settings.ts  Settings form and local storage
  main.ts      Polling loop and wiring
```

For each aircraft the app computes:

- **Bearing** from you to the plane (great-circle initial bearing), then the **relative bearing** against the direction you face, in (-180°, 180°]. Negative is left of centre, positive is right. Planes within half the cone width on either side are in view, and sorting by relative bearing gives the left-to-right order.
- **Elevation angle**: `atan2(altitude − your elevation − d²/2R, d)`, where `d` is ground distance and `R` is Earth's radius. The `d²/2R` term accounts for the ground curving away.

For routes, adsb.im returns the full routing for a flight number (e.g. `ATL-GEG-ATL`). The app scores each leg by how far the plane is from that great-circle path and whether it's heading toward that leg's destination, then shows the best match.

## Data sources and attribution

- Aircraft positions: [adsb.lol](https://adsb.lol) (open data under ODbL), with [adsb.fi](https://adsb.fi) as a fallback
- Routes: [adsb.im](https://adsb.im)

These are free community services run by volunteers. Keep the refresh interval reasonable, and check each provider's terms before running a busy public deployment or using the data commercially. Positions and routes are crowd-sourced and can be missing or wrong. Don't use this for anything safety-related.

## License

[MIT](LICENSE)
