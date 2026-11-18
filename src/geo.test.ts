import { describe, expect, it } from "vitest";
import {
  destinationPoint,
  elevationAngle,
  haversineKm,
  inCone,
  initialBearing,
  pathOffset,
  project,
  relativeBearing,
} from "./geo";

const origin = { lat: 0, lon: 0 };

describe("initialBearing", () => {
  it("points to the cardinal directions", () => {
    expect(initialBearing(origin, { lat: 1, lon: 0 })).toBeCloseTo(0);
    expect(initialBearing(origin, { lat: 0, lon: 1 })).toBeCloseTo(90);
    expect(initialBearing(origin, { lat: -1, lon: 0 })).toBeCloseTo(180);
    expect(initialBearing(origin, { lat: 0, lon: -1 })).toBeCloseTo(270);
  });
});

describe("haversineKm", () => {
  it("one degree of latitude is ~111 km", () => {
    expect(haversineKm(origin, { lat: 1, lon: 0 })).toBeCloseTo(111.19, 1);
  });
});

describe("relativeBearing", () => {
  it("wraps across north", () => {
    expect(relativeBearing(10, 350)).toBeCloseTo(20);
    expect(relativeBearing(340, 10)).toBeCloseTo(-30);
  });
  it("is negative to the left and positive to the right", () => {
    expect(relativeBearing(60, 90)).toBeCloseTo(-30);
    expect(relativeBearing(120, 90)).toBeCloseTo(30);
  });
  it("maps directly behind to 180", () => {
    expect(relativeBearing(270, 90)).toBe(180);
  });
});

describe("inCone", () => {
  it("includes the edges", () => {
    expect(inCone(45, 90)).toBe(true);
    expect(inCone(-45, 90)).toBe(true);
    expect(inCone(45.01, 90)).toBe(false);
  });
});

describe("elevationAngle", () => {
  it("is 45° when altitude equals distance (nearby)", () => {
    expect(elevationAngle(1, 1000, 0)).toBeCloseTo(45, 1);
  });
  it("is negative for a low aircraft far away (curvature)", () => {
    // 200 km away the Earth drops ~3.1 km, so 1 km altitude is below the horizon.
    expect(elevationAngle(200, 1000, 0)).toBeLessThan(0);
  });
  it("accounts for observer elevation", () => {
    expect(elevationAngle(1, 100, 200)).toBeLessThan(0);
  });
});

describe("destinationPoint", () => {
  it("round-trips with bearing and distance", () => {
    const p = { lat: 51.5, lon: -0.1 };
    const q = destinationPoint(p, 73, 25);
    expect(haversineKm(p, q)).toBeCloseTo(25, 3);
    expect(initialBearing(p, q)).toBeCloseTo(73, 1);
  });
});

describe("pathOffset", () => {
  const a = { lat: 0, lon: 0 };
  const b = { lat: 0, lon: 10 };
  it("measures distance off and along the path", () => {
    const o = pathOffset({ lat: 1, lon: 5 }, a, b);
    expect(o.crossKm).toBeCloseTo(111.2, 0);
    expect(o.alongKm).toBeCloseTo(556, -1);
    expect(o.lengthKm).toBeCloseTo(1112, -1);
  });
  it("is negative along-track behind the start", () => {
    expect(pathOffset({ lat: 0, lon: -2 }, a, b).alongKm).toBeCloseTo(-222.4, 0);
  });
});

describe("project", () => {
  const view = {
    observer: origin,
    observerAltM: 0,
    facing: 0,
    coneWidth: 90,
    maxDistKm: 100,
    minElev: 0,
  };
  it("orders a NW plane left of a NE plane when facing north", () => {
    const nw = project(view, { lat: 0.2, lon: -0.1, altM: 10000 });
    const ne = project(view, { lat: 0.2, lon: 0.1, altM: 10000 });
    expect(nw.visible && ne.visible).toBe(true);
    expect(nw.rel).toBeLessThan(ne.rel);
  });
  it("hides planes behind, too far, or too low", () => {
    expect(project(view, { lat: -0.2, lon: 0, altM: 10000 }).visible).toBe(false);
    expect(project(view, { lat: 2, lon: 0, altM: 10000 }).visible).toBe(false);
    expect(project({ ...view, minElev: 20 }, { lat: 0.5, lon: 0, altM: 3000 }).visible).toBe(false);
  });
});
