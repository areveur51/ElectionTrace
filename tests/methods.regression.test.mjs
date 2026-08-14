import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  METHODS,
  METHOD_BY_ID,
  applyCrossRowFlags,
  applyFlags,
  buildStateStats,
  buildWorkup,
  flagRow,
  hasRepeatingDigits,
  hasSequentialDigits,
  residual,
  whyFlagged,
  workupChecks,
} from "../app/lib/methods.mjs";

const ST = {
  densP995: 1000,
  densMedian: 50,
  votesP995: 4000,
  votesMedian: 600,
};

function mixed(extra = {}) {
  return {
    votes_total: 400,
    votes_dem: 180,
    votes_rep: 200,
    votes_per_sqkm: 40,
    pct_dem_lead: -5,
    ...extra,
  };
}

describe("method catalog", () => {
  it("has unique ids and a definition for every detector", () => {
    const ids = METHODS.map((m) => m.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const m of METHODS) {
      assert.equal(METHOD_BY_ID[m.id], m);
      assert.ok(m.name);
      assert.ok(m.rule);
      assert.ok(m.group);
      assert.ok(m.color);
      assert.ok(m.plain?.about);
      assert.ok(m.plain?.whyFlagged);
      assert.ok(m.plain?.whyAnomaly);
      assert.doesNotMatch(
        `${m.plain.about} ${m.plain.whyFlagged} ${m.plain.whyAnomaly} ${m.summary || ""}`,
        /not a verdict|look closer|not proof of fraud|not automatically wrong|not a finding of fabrication/i,
      );
    }
  });

  it("links night-file findings only to methods that use the same comparison", () => {
    const linked = METHODS.filter((m) => m.sameAs?.length);
    assert.deepEqual(
      linked.map((m) => m.id).sort(),
      ["count_retraction", "lead_mismatch", "negative_residual", "one_sided_increment", "vote_transfer"],
    );
    for (const m of linked) {
      for (const link of m.sameAs) {
        assert.ok(link.id && (link.tab === "files" || link.tab === "patterns"), m.id);
      }
    }
  });

  it("returns workup checks and a why line for every method", () => {
    const row = mixed({
      flags: METHODS.map((m) => m.id),
      votes_dem_prev: 100,
      votes_rep_prev: 100,
      votes_total_prev: 220,
    });
    for (const m of METHODS) {
      const why = whyFlagged(row, m.id, ST);
      assert.ok(String(why).length > 0, m.id);
      const checks = workupChecks(row, m.id, ST, { countyRows: [row] });
      assert.ok(Array.isArray(checks), m.id);
      assert.ok(checks.length > 0, m.id);
    }
  });
});

describe("flagRow regression — fires", () => {
  const yes = [
    ["zero_votes", { votes_total: 0, votes_dem: 0, votes_rep: 0 }],
    ["negative_residual", { votes_total: 10, votes_dem: 8, votes_rep: 8, votes_per_sqkm: 1, pct_dem_lead: 0 }],
    ["other_share", { votes_total: 100, votes_dem: 20, votes_rep: 20, votes_per_sqkm: 10, pct_dem_lead: 0 }],
    ["unanimous", { votes_total: 50, votes_dem: 50, votes_rep: 0, votes_per_sqkm: 10, pct_dem_lead: 100 }],
    ["near_unanimous", { votes_total: 100, votes_dem: 98, votes_rep: 2, votes_per_sqkm: 10, pct_dem_lead: 96 }],
    [
      "density_spike",
      { votes_total: 80, votes_dem: 30, votes_rep: 45, votes_per_sqkm: 9000, pct_dem_lead: -18.75 },
    ],
    [
      "mega_precinct",
      { votes_total: 5000, votes_dem: 2400, votes_rep: 2500, votes_per_sqkm: 40, pct_dem_lead: -2 },
    ],
    ["non_integer", mixed({ votes_total: 400.5, votes_dem: 180, votes_rep: 200, pct_dem_lead: -5 })],
    ["negative_votes", mixed({ votes_dem: -5, votes_rep: 200, votes_total: 195, pct_dem_lead: -105.1 })],
    ["lead_mismatch", mixed({ pct_dem_lead: 40 })],
    ["repeating_digits", mixed({ votes_total: 1111, votes_dem: 500, votes_rep: 600, pct_dem_lead: -9 })],
    ["round_block", { votes_total: 800, votes_dem: 300, votes_rep: 500, votes_per_sqkm: 10, pct_dem_lead: -25 }],
    [
      "vote_transfer",
      mixed({
        votes_total: 400,
        votes_dem: 120,
        votes_rep: 260,
        pct_dem_lead: -35,
        votes_dem_prev: 200,
        votes_rep_prev: 180,
        votes_total_prev: 400,
      }),
    ],
    [
      "count_retraction",
      mixed({
        votes_total: 300,
        votes_dem: 140,
        votes_rep: 150,
        pct_dem_lead: -3.3,
        votes_dem_prev: 160,
        votes_rep_prev: 170,
        votes_total_prev: 350,
      }),
    ],
    [
      "one_sided_increment",
      mixed({
        votes_total: 500,
        votes_dem: 50,
        votes_rep: 440,
        pct_dem_lead: -78,
        votes_dem_prev: 45,
        votes_rep_prev: 200,
        votes_total_prev: 255,
      }),
    ],
    ["sequential_digits", mixed({ votes_total: 1234, votes_dem: 500, votes_rep: 700, pct_dem_lead: -16.2 })],
    ["exact_tie", mixed({ votes_total: 220, votes_dem: 110, votes_rep: 110, pct_dem_lead: 0 })],
  ];

  for (const [id, row] of yes) {
    it(`flags ${id}`, () => {
      assert.ok(flagRow(row, ST).includes(id), flagRow(row, ST).join(","));
    });
  }
});

describe("flagRow regression — near misses do not fire", () => {
  const no = [
    ["zero_votes", mixed({ votes_total: 1, votes_dem: 0, votes_rep: 1, pct_dem_lead: -100 })],
    ["negative_residual", mixed()],
    ["other_share", mixed({ votes_total: 100, votes_dem: 40, votes_rep: 40, pct_dem_lead: 0 })],
    ["unanimous", mixed({ votes_total: 49, votes_dem: 49, votes_rep: 0, pct_dem_lead: 100 })],
    ["near_unanimous", mixed({ votes_total: 100, votes_dem: 90, votes_rep: 10, pct_dem_lead: 80 })],
    ["density_spike", mixed({ votes_per_sqkm: 200 })],
    ["mega_precinct", mixed({ votes_total: 3999, votes_dem: 1900, votes_rep: 2000, pct_dem_lead: -2.5 })],
    ["non_integer", mixed()],
    ["negative_votes", mixed()],
    ["lead_mismatch", mixed({ pct_dem_lead: -5 })],
    ["repeating_digits", mixed({ votes_total: 111, votes_dem: 50, votes_rep: 60, pct_dem_lead: -9 })],
    ["round_block", mixed({ votes_total: 399, votes_dem: 200, votes_rep: 199, pct_dem_lead: 0.3 })],
    ["vote_transfer", mixed()],
    ["count_retraction", mixed()],
    ["one_sided_increment", mixed()],
    ["sequential_digits", mixed({ votes_total: 1123, votes_dem: 500, votes_rep: 600, pct_dem_lead: -8.9 })],
    ["exact_tie", mixed({ votes_total: 80, votes_dem: 40, votes_rep: 40, pct_dem_lead: 0 })],
  ];

  for (const [id, row] of no) {
    it(`does not flag ${id} on a near miss`, () => {
      assert.ok(!flagRow(row, ST).includes(id), flagRow(row, ST).join(","));
    });
  }

  it("leaves a normal mixed precinct unflagged", () => {
    assert.deepEqual(flagRow(mixed(), ST), []);
  });
});

describe("helpers", () => {
  it("treats 1111 as repeating and 111 as not", () => {
    assert.equal(hasRepeatingDigits(1111), true);
    assert.equal(hasRepeatingDigits(111), false);
  });

  it("detects rising and falling digit runs", () => {
    assert.equal(hasSequentialDigits(1234), true);
    assert.equal(hasSequentialDigits(4321), true);
    assert.equal(hasSequentialDigits(1123), false);
    assert.equal(hasSequentialDigits(123), false);
  });

  it("computes residual as total minus the two majors", () => {
    assert.equal(residual({ votes_dem: 10, votes_rep: 20, votes_total: 35 }), 5);
    assert.equal(residual({ votes_dem: 10, votes_rep: 20, votes_total: 25 }), -5);
  });
});

describe("cross-row regression", () => {
  it("flags duplicate_tally at 3 copies and not at 2", () => {
    const three = [1, 2, 3].map((i) => ({
      geoid: `06-${i}`,
      countyFips: "06001",
      votes_dem: 80,
      votes_rep: 70,
      votes_total: 160,
      flags: [],
    }));
    applyCrossRowFlags(three);
    assert.ok(three.every((r) => r.flags.includes("duplicate_tally")));
    const two = three.slice(0, 2).map((r) => ({ ...r, flags: [] }));
    applyCrossRowFlags(two);
    assert.ok(two.every((r) => !r.flags.includes("duplicate_tally")));
  });

  it("flags same_candidate_run at 4 near-unanimous neighbors", () => {
    const rows = [1, 2, 3, 4].map((i) => ({
      geoid: `05-${i}`,
      countyFips: "05047",
      votes_dem: 1,
      votes_rep: 80,
      votes_total: 81,
      flags: [],
    }));
    applyCrossRowFlags(rows);
    assert.ok(rows.every((r) => r.flags.includes("same_candidate_run")));
  });

  it("flags ratio_clone when five precincts share an odd split", () => {
    const rows = [1, 2, 3, 4, 5].map((i) => ({
      geoid: `06-${i}`,
      countyFips: "06001",
      votes_dem: 211,
      votes_rep: 189,
      votes_total: 400 + i,
      flags: [],
    }));
    applyCrossRowFlags(rows);
    assert.ok(rows.every((r) => r.flags.includes("ratio_clone")));
  });

  it("does not clone a common 60/40 split", () => {
    const rows = [1, 2, 3, 4, 5].map((i) => ({
      geoid: `06-${i}`,
      countyFips: "06001",
      votes_dem: 60,
      votes_rep: 40,
      votes_total: 100 + i,
      flags: [],
    }));
    applyCrossRowFlags(rows);
    assert.ok(rows.every((r) => !r.flags.includes("ratio_clone")));
  });

  it("flags total_sequence on a 100/150/200/250 ladder", () => {
    const rows = [100, 150, 200, 250].map((t, i) => ({
      geoid: `08-${i}`,
      countyFips: "08031",
      votes_dem: 40,
      votes_rep: t - 40,
      votes_total: t,
      flags: [],
    }));
    applyCrossRowFlags(rows);
    assert.ok(rows.every((r) => r.flags.includes("total_sequence")));
  });

  it("does not flag a wobbly total run", () => {
    const rows = [100, 151, 198, 260].map((t, i) => ({
      geoid: `08-${i}`,
      countyFips: "08031",
      votes_dem: 40,
      votes_rep: t - 40,
      votes_total: t,
      flags: [],
    }));
    applyCrossRowFlags(rows);
    assert.ok(rows.every((r) => !r.flags.includes("total_sequence")));
  });

  it("flags last_digit_stack when one digit dominates a county", () => {
    const rows = [20, 30, 40, 50, 60, 70, 80, 90].map((t, i) => ({
      geoid: `04-${i}`,
      countyFips: "04013",
      votes_dem: 10,
      votes_rep: t - 10,
      votes_total: t,
      flags: [],
    }));
    applyCrossRowFlags(rows);
    assert.ok(rows.every((r) => r.flags.includes("last_digit_stack")));
  });

  it("flags zero_cluster at 12 zeros that are 15%+ of a county", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      geoid: `06-z${i}`,
      countyFips: "06075",
      votes_dem: 0,
      votes_rep: 0,
      votes_total: 0,
      flags: [],
    }));
    applyCrossRowFlags(rows);
    assert.ok(rows.every((r) => r.flags.includes("zero_cluster")));
  });

  it("does not treat 11 zeros as a cluster", () => {
    const rows = Array.from({ length: 11 }, (_, i) => ({
      geoid: `06-z${i}`,
      countyFips: "06075",
      votes_dem: 0,
      votes_rep: 0,
      votes_total: 0,
      flags: [],
    }));
    applyCrossRowFlags(rows);
    assert.ok(rows.every((r) => !r.flags.includes("zero_cluster")));
  });
});

describe("compound_flag", () => {
  it("marks a row that already has three other flags", () => {
    const rows = [
      {
        geoid: "06-x",
        stateFips: "06",
        stateName: "California",
        countyFips: "06001",
        votes_total: 1111.5,
        votes_dem: 400,
        votes_rep: 700,
        votes_per_sqkm: 40,
        pct_dem_lead: 40,
        flags: [],
      },
    ];
    const stats = buildStateStats(rows);
    applyFlags(rows, stats);
    assert.ok(rows[0].flags.includes("non_integer"));
    assert.ok(rows[0].flags.includes("repeating_digits"));
    assert.ok(rows[0].flags.includes("lead_mismatch"));
    assert.ok(rows[0].flags.includes("compound_flag"));
  });
});

describe("workup packet", () => {
  it("includes plain language and checks for a new pattern flag", () => {
    const row = mixed({
      votes_total: 1234,
      votes_dem: 500,
      votes_rep: 700,
      pct_dem_lead: -16.2,
      flags: ["sequential_digits"],
    });
    const w = buildWorkup(row, ST);
    assert.equal(w.flags[0].plain.about.includes("1234") || w.flags[0].plain.about.includes("run"), true);
    assert.ok(w.flags[0].checks.some((c) => c.expr.includes("sequential")));
  });
});
