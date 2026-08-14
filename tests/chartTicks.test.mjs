import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { pickXTickIndexes } from "../app/lib/chartTicks.mjs";

test("keeps first and last when they are far enough apart", () => {
  const pts = Array.from({ length: 20 }, (_, i) => ({ ms: i * 1000 }));
  const xAt = (_p, i) => i * 50;
  const ticks = pickXTickIndexes(pts, xAt, { maxTicks: 8, minGap: 120 });
  assert.equal(ticks[0], 0);
  assert.equal(ticks[ticks.length - 1], 19);
  for (let k = 1; k < ticks.length; k++) {
    assert.ok(xAt(pts[ticks[k]], ticks[k]) - xAt(pts[ticks[k - 1]], ticks[k - 1]) >= 120);
  }
});

test("drops mid ticks when timestamps cluster in one pixel pile", () => {
  const pts = [
    { ms: 0 },
    { ms: 10 },
    { ms: 20 },
    { ms: 30 },
    { ms: 40 },
    { ms: 10_000 },
  ];
  const tmin = 0;
  const tmax = 10_000;
  const xAt = (p) => ((p.ms - tmin) / (tmax - tmin)) * 900;
  const ticks = pickXTickIndexes(pts, xAt, { maxTicks: 8, minGap: 120 });
  assert.ok(ticks.length <= 3);
  assert.equal(ticks[0], 0);
  assert.equal(ticks[ticks.length - 1], pts.length - 1);
  for (let k = 1; k < ticks.length; k++) {
    assert.ok(xAt(pts[ticks[k]]) - xAt(pts[ticks[k - 1]]) >= 120);
  }
});

test("popup chart uses spaced tick picker", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../app/public/app.js"), "utf8");
  assert.match(src, /pickXTickIndexes/);
  assert.match(src, /minGap/);
});
