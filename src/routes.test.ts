import { describe, expect, it } from "vitest";
import { airportCode, pickLeg, type Airport } from "./routes";

const apt = (iata: string, lat: number, lon: number): Airport => ({ iata, icao: "", name: iata, city: "", lat, lon });
const ATL = apt("ATL", 33.6367, -84.4281);
const BZN = apt("BZN", 45.7775, -111.153);
const CLT = apt("CLT", 35.214, -80.9431);
const IAH = apt("IAH", 29.9844, -95.3414);

describe("pickLeg", () => {
  const atlBznAtl = { airports: [ATL, BZN, ATL], plausible: true };

  it("picks the inbound leg for a plane heading toward ATL", () => {
    // Over Alabama, flying south-east toward Atlanta.
    const r = pickLeg(atlBznAtl, { callsign: "DAL406", lat: 34.3, lon: -86.5, track: 115 })!;
    expect(`${airportCode(r.origin)}-${airportCode(r.destination)}`).toBe("BZN-ATL");
    expect(r.confident).toBe(true);
  });

  it("picks the outbound leg for a plane heading away from ATL", () => {
    const r = pickLeg(atlBznAtl, { callsign: "DAL406", lat: 34.3, lon: -86.5, track: 295 })!;
    expect(`${airportCode(r.origin)}-${airportCode(r.destination)}`).toBe("ATL-BZN");
  });

  it("marks a route unverified when the plane is nowhere near it", () => {
    // Over Ohio, far from the CLT–IAH path.
    const r = pickLeg({ airports: [CLT, IAH], plausible: true }, { callsign: "X", lat: 40, lon: -83, track: 0 })!;
    expect(r.confident).toBe(false);
  });

  it("marks a route unverified when the plane flies away from the destination", () => {
    const r = pickLeg({ airports: [CLT, IAH], plausible: true }, { callsign: "X", lat: 33.5, lon: -86, track: 60 })!;
    expect(r.confident).toBe(false);
  });

  it("trusts the server's plausibility flag", () => {
    const r = pickLeg({ airports: [CLT, IAH], plausible: false }, { callsign: "X", lat: 33.5, lon: -86, track: 240 })!;
    expect(r.confident).toBe(false);
  });

  it("returns null with no route", () => {
    expect(pickLeg({ airports: [], plausible: false }, { callsign: "X", lat: 0, lon: 0, track: null })).toBeNull();
  });
});
