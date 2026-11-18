import { defineConfig } from "vite";

// adsb.lol and adsb.fi don't send CORS headers, so the browser talks to them through this proxy.
const proxy = {
  "/adsb/": {
    target: "https://api.adsb.lol",
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/adsb/, ""),
  },
  "/adsbfi/": {
    target: "https://opendata.adsb.fi",
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/adsbfi/, ""),
  },
};

export default defineConfig({
  server: { proxy },
  preview: { proxy },
});
