import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeHistory,
  resolveCandidates,
  resolveYear,
  yearFromName,
} from "../app/lib/candidates.mjs";
import { featureCollectionToBuffer, scanGeojsonBuffer } from "../app/lib/scan.mjs";

describe("candidates", () => {
  it("reads the year from a filename", () => {
    assert.equal(yearFromName("precincts-with-results-2024.geojson.gz"), 2024);
    assert.equal(yearFromName("precincts-with-results.geojson.gz"), null);
  });

  it("defaults the lab extract to 2020 Biden / Trump", () => {
    const c = resolveCandidates({ sourceName: "precincts-with-results.geojson.gz" });
    assert.equal(c.year, 2020);
    assert.equal(c.demShort, "Biden");
    assert.equal(c.repShort, "Trump");
    assert.match(c.dem, /Biden/);
    assert.match(c.rep, /Trump/);
  });

  it("uses 2024 Harris / Trump when the year is 2024", () => {
    const c = resolveCandidates({ props: { year: 2024 } });
    assert.equal(c.demShort, "Harris");
    assert.equal(resolveYear({ props: { year: 2024 } }), 2024);
  });

  it("honors explicit candidate fields", () => {
    const c = resolveCandidates({
      props: { candidate_dem: "Jane Doe", candidate_rep: "John Roe" },
    });
    assert.equal(c.dem, "Jane Doe");
    assert.equal(c.rep, "John Roe");
  });

  it("builds a two-point series from prior-report fields", () => {
    const series = normalizeHistory(
      {},
      {
        votes_dem: 80,
        votes_rep: 120,
        votes_total: 200,
        votes_dem_prev: 40,
        votes_rep_prev: 50,
        votes_total_prev: 90,
      },
    );
    assert.equal(series.length, 2);
    assert.equal(series[0].votes_total, 90);
    assert.equal(series[1].votes_dem, 80);
  });
});

describe("scan candidate + history", () => {
  it("keeps names and a history array on the row", async () => {
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
          year: 2020,
          candidate_dem: "Joseph R. Biden Jr.",
          candidate_rep: "Donald J. Trump",
          history: [
            { ts: "2020-11-03T20:00:00Z", votes_dem: 40, votes_rep: 50, votes_total: 90 },
            { ts: "2020-11-04T08:00:00Z", votes_dem: 80, votes_rep: 120, votes_total: 200 },
          ],
        },
        geometry: { type: "Point", coordinates: [-122.3, 37.75] },
      },
    ]);
    const rows = [];
    await scanGeojsonBuffer(buf, (row) => rows.push(row));
    assert.equal(rows[0].candidate_dem, "Joseph R. Biden Jr.");
    assert.equal(rows[0].candidate_rep, "Donald J. Trump");
    assert.equal(rows[0].history.length, 2);
    assert.equal(rows[0].votes_total_prev, 90);
  });
});
