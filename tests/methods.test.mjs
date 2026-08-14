import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  METHODS,
  applyCrossRowFlags,
  applyFlags,
  benfordMad,
  buildStateStats,
  buildWorkup,
  computedLead,
  flagRow,
  hasRepeatingDigits,
  residual,
  workupChecks,
} from "../app/lib/methods.mjs";
import { scanGeojsonBuffer, featureCollectionToBuffer } from "../app/lib/scan.mjs";
import { stateFromGeoid } from "../app/lib/fips.mjs";

describe("stateFromGeoid", () => {
  it("reads Arkansas FIPS from precinct GEOID", () => {
    const s = stateFromGeoid("05047-1-A (Oz Wd 1)");
    assert.equal(s.fips, "05");
    assert.equal(s.name, "Arkansas");
    assert.equal(s.countyFips, "05047");
  });
});

describe("detectors", () => {
  const st = {
    densP995: 1000,
    densMedian: 50,
    votesP995: 4000,
    votesMedian: 600,
  };

  it("flags zero votes", () => {
    assert.deepEqual(flagRow({ votes_total: 0, votes_dem: 0, votes_rep: 0 }, st), [
      "zero_votes",
    ]);
  });

  it("flags impossible arithmetic", () => {
    const flags = flagRow(
      { votes_total: 10, votes_dem: 8, votes_rep: 8, votes_per_sqkm: 1 },
      st,
    );
    assert.ok(flags.includes("negative_residual"));
  });

  it("flags high other share", () => {
    const flags = flagRow(
      { votes_total: 100, votes_dem: 20, votes_rep: 20, votes_per_sqkm: 10 },
      st,
    );
    assert.ok(flags.includes("other_share"));
  });

  it("flags unanimous at min votes", () => {
    const flags = flagRow(
      { votes_total: 50, votes_dem: 50, votes_rep: 0, votes_per_sqkm: 10 },
      st,
    );
    assert.ok(flags.includes("unanimous"));
  });

  it("does not flag a normal mixed precinct", () => {
    const flags = flagRow(
      {
        votes_total: 400,
        votes_dem: 180,
        votes_rep: 200,
        votes_per_sqkm: 40,
        pct_dem_lead: -5,
      },
      st,
    );
    assert.deepEqual(flags, []);
  });

  it("flags a fractional vote count", () => {
    const flags = flagRow(
      { votes_total: 100.5, votes_dem: 40, votes_rep: 60, votes_per_sqkm: 10, pct_dem_lead: -20 },
      st,
    );
    assert.ok(flags.includes("non_integer"));
  });

  it("flags a negative vote count", () => {
    const flags = flagRow(
      { votes_total: 80, votes_dem: -5, votes_rep: 85, votes_per_sqkm: 10, pct_dem_lead: -112.5 },
      st,
    );
    assert.ok(flags.includes("negative_votes"));
  });

  it("flags a lead that does not match the counts", () => {
    const flags = flagRow(
      { votes_total: 200, votes_dem: 80, votes_rep: 120, votes_per_sqkm: 10, pct_dem_lead: 40 },
      st,
    );
    assert.ok(flags.includes("lead_mismatch"));
    assert.ok(Math.abs(computedLead({ votes_dem: 80, votes_rep: 120, votes_total: 200 }) + 20) < 1e-9);
  });

  it("flags repeating digits of length 4, not 111", () => {
    assert.equal(hasRepeatingDigits(1111), true);
    assert.equal(hasRepeatingDigits(111), false);
    const flags = flagRow(
      { votes_total: 1111, votes_dem: 400, votes_rep: 700, votes_per_sqkm: 10, pct_dem_lead: -27 },
      st,
    );
    assert.ok(flags.includes("repeating_digits"));
  });

  it("flags a round-number block", () => {
    const flags = flagRow(
      { votes_total: 800, votes_dem: 300, votes_rep: 500, votes_per_sqkm: 10, pct_dem_lead: -25 },
      st,
    );
    assert.ok(flags.includes("round_block"));
  });

  it("flags votes moved between candidates when a prior report exists", () => {
    const flags = flagRow(
      {
        votes_total: 400,
        votes_dem: 120,
        votes_rep: 260,
        votes_per_sqkm: 10,
        pct_dem_lead: -35,
        votes_dem_prev: 200,
        votes_rep_prev: 180,
        votes_total_prev: 400,
      },
      st,
    );
    assert.ok(flags.includes("vote_transfer"));
    assert.ok(!flags.includes("count_retraction"));
  });

  it("flags a total that went backwards", () => {
    const flags = flagRow(
      {
        votes_total: 300,
        votes_dem: 140,
        votes_rep: 150,
        votes_per_sqkm: 10,
        pct_dem_lead: -3.3,
        votes_dem_prev: 160,
        votes_rep_prev: 170,
        votes_total_prev: 350,
      },
      st,
    );
    assert.ok(flags.includes("count_retraction"));
  });

  it("flags a one-sided batch increment", () => {
    const flags = flagRow(
      {
        votes_total: 500,
        votes_dem: 50,
        votes_rep: 440,
        votes_per_sqkm: 10,
        pct_dem_lead: -78,
        votes_dem_prev: 45,
        votes_rep_prev: 200,
        votes_total_prev: 255,
      },
      st,
    );
    assert.ok(flags.includes("one_sided_increment"));
  });

  it("flags density spike against state stats", () => {
    const flags = flagRow(
      {
        votes_total: 80,
        votes_dem: 30,
        votes_rep: 45,
        votes_per_sqkm: 9000,
        pct_dem_lead: -18,
      },
      st,
    );
    assert.ok(flags.includes("density_spike"));
  });
});

describe("cross-row pattern flags", () => {
  it("flags a duplicated county tally", () => {
    const rows = [1, 2, 3].map((i) => ({
      geoid: `06001-p${i}`,
      countyFips: "06001",
      stateFips: "06",
      votes_dem: 80,
      votes_rep: 70,
      votes_total: 160,
      flags: [],
    }));
    applyCrossRowFlags(rows);
    assert.ok(rows.every((r) => r.flags.includes("duplicate_tally")));
  });

  it("flags a same-candidate precinct run", () => {
    const rows = [1, 2, 3, 4].map((i) => ({
      geoid: `05047-${i}`,
      countyFips: "05047",
      stateFips: "05",
      votes_dem: 1,
      votes_rep: 80,
      votes_total: 81,
      flags: [],
    }));
    applyCrossRowFlags(rows);
    assert.ok(rows.every((r) => r.flags.includes("same_candidate_run")));
  });

  it("does not flag a short or mixed neighbor streak", () => {
    const rows = [
      { geoid: "a", countyFips: "01", votes_dem: 80, votes_rep: 2, votes_total: 82, flags: [] },
      { geoid: "b", countyFips: "01", votes_dem: 80, votes_rep: 2, votes_total: 82, flags: [] },
      { geoid: "c", countyFips: "01", votes_dem: 40, votes_rep: 40, votes_total: 80, flags: [] },
    ];
    applyCrossRowFlags(rows);
    assert.ok(rows.every((r) => !r.flags.includes("same_candidate_run")));
    assert.ok(rows.every((r) => !r.flags.includes("duplicate_tally")));
  });
});

describe("workup", () => {
  it("lists passing checks for a density spike", () => {
    const row = {
      geoid: "06-x",
      stateFips: "06",
      votes_total: 80,
      votes_dem: 30,
      votes_rep: 45,
      votes_per_sqkm: 9000,
      pct_dem_lead: -18,
      flags: ["density_spike"],
    };
    const st = { densP995: 1000, densMedian: 50, votesP995: 4000, votesMedian: 600 };
    const checks = workupChecks(row, "density_spike", st);
    assert.ok(checks.every((c) => c.ok));
    const w = buildWorkup(row, st, { indexedAt: "2026-01-01T00:00:00Z" });
    assert.equal(w.kind, "electiontrace.workup");
    assert.equal(w.flags[0].id, "density_spike");
    assert.equal(w.disclaimer, undefined);
  });

  it("gives every method a layman explanation", () => {
    for (const m of METHODS) {
      assert.ok(m.plain?.about, m.id);
      assert.ok(m.plain?.whyFlagged, m.id);
      assert.ok(m.plain?.whyAnomaly, m.id);
    }
  });
});

describe("applyFlags", () => {
  it("uses per-state tails", () => {
    const rows = [
      {
        stateFips: "06",
        stateName: "California",
        votes_total: 100,
        votes_dem: 50,
        votes_rep: 50,
        votes_per_sqkm: 10,
        pct_dem_lead: 0,
        flags: [],
      },
      {
        stateFips: "06",
        stateName: "California",
        votes_total: 0,
        votes_dem: 0,
        votes_rep: 0,
        votes_per_sqkm: 0,
        pct_dem_lead: 0,
        flags: [],
      },
    ];
    const stats = buildStateStats(rows);
    applyFlags(rows, stats);
    assert.deepEqual(rows[1].flags, ["zero_votes"]);
    assert.equal(rows[0].votes_other, 0);
    assert.equal(residual(rows[0]), 0);
  });
});

describe("benfordMad", () => {
  it("needs a minimum sample", () => {
    assert.equal(benfordMad([1, 2, 3]).mad, null);
  });
  it("is close on a synthetic Benford-ish series", () => {
    const vals = [];
    for (let d = 1; d <= 9; d++) {
      const share = Math.log10(1 + 1 / d);
      for (let i = 0; i < Math.round(share * 400); i++) vals.push(d * 10);
    }
    const r = benfordMad(vals);
    assert.ok(r.n >= 50);
    assert.ok(r.mad < 0.02);
  });
});

describe("scan", () => {
  it("does not leak the next feature's vote counts into the centroid", async () => {
    const buf = featureCollectionToBuffer([
      {
        type: "Feature",
        properties: {
          GEOID: "05047-test",
          votes_dem: 79,
          votes_rep: 279,
          votes_total: 366,
          votes_per_sqkm: 54.2,
          pct_dem_lead: -54.6,
        },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-93.9, 35.4],
              [-93.8, 35.4],
              [-93.8, 35.5],
              [-93.9, 35.5],
              [-93.9, 35.4],
            ],
          ],
        },
      },
      {
        type: "Feature",
        properties: {
          GEOID: "06001-test",
          votes_dem: 10,
          votes_rep: 20,
          votes_total: 30,
          votes_per_sqkm: 12,
          pct_dem_lead: -33,
        },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-122.4, 37.7],
              [-122.3, 37.7],
              [-122.3, 37.8],
              [-122.4, 37.8],
              [-122.4, 37.7],
            ],
          ],
        },
      },
    ]);
    const rows = [];
    await scanGeojsonBuffer(buf, (row) => rows.push(row));
    assert.equal(rows.length, 2);
    assert.ok(rows[0].lat > 35 && rows[0].lat < 36, `ar lat ${rows[0].lat}`);
    assert.ok(rows[0].lng < -93 && rows[0].lng > -94, `ar lng ${rows[0].lng}`);
    assert.ok(rows[1].lat > 37 && rows[1].lat < 38);
  });

  it("reads properties and a centroid", async () => {
    const buf = featureCollectionToBuffer([
      {
        type: "Feature",
        properties: {
          GEOID: "06001-test",
          votes_dem: 10,
          votes_rep: 20,
          votes_total: 30,
          votes_per_sqkm: 12,
          pct_dem_lead: -33,
        },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-122.4, 37.7],
              [-122.3, 37.7],
              [-122.3, 37.8],
              [-122.4, 37.8],
              [-122.4, 37.7],
            ],
          ],
        },
      },
    ]);
    const rows = [];
    await scanGeojsonBuffer(buf, (row) => rows.push(row));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].stateName, "California");
    assert.ok(rows[0].lat > 37 && rows[0].lat < 38);
    assert.ok(rows[0].lng < -122);
  });

  it("reads a prior report from history[]", async () => {
    const buf = featureCollectionToBuffer([
      {
        type: "Feature",
        properties: {
          GEOID: "06001-test",
          votes_dem: 80,
          votes_rep: 120,
          votes_total: 200,
          votes_per_sqkm: 12,
          pct_dem_lead: -20,
          history: [
            { ts: "2024-11-05T20:00:00Z", votes_dem: 40, votes_rep: 50, votes_total: 90 },
            { ts: "2024-11-06T02:00:00Z", votes_dem: 80, votes_rep: 120, votes_total: 200 },
          ],
        },
        geometry: {
          type: "Point",
          coordinates: [-122.3, 37.75],
        },
      },
    ]);
    const rows = [];
    await scanGeojsonBuffer(buf, (row) => rows.push(row));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].votes_dem_prev, 40);
    assert.equal(rows[0].votes_rep_prev, 50);
    assert.equal(rows[0].votes_total_prev, 90);
  });
});
