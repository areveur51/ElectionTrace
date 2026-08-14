import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { mediaFiles, resolveMediaDir } from "../app/lib/index.mjs";
import { nytStatesDir } from "../app/lib/nytStates.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("sample precincts are used when the preferred media dir has no extract", () => {
  const sample = join(root, "media", "sample");
  const empty = join(root, "media", "sample", "nyt-election-data");
  assert.ok(mediaFiles(sample).length >= 1);
  assert.equal(mediaFiles(empty).length, 0);
  assert.equal(resolveMediaDir(root, empty), sample);
});

test("night-file loader prefers an explicit directory with JSON", () => {
  const sample = join(root, "media", "sample", "nyt-election-data");
  assert.ok(nytStatesDir(root).endsWith("nyt-election-data"));
  const prev = process.env.NYT_STATES_DIR;
  process.env.NYT_STATES_DIR = sample;
  try {
    assert.equal(nytStatesDir(root), sample);
  } finally {
    if (prev === undefined) delete process.env.NYT_STATES_DIR;
    else process.env.NYT_STATES_DIR = prev;
  }
});

test("source has no machine-local data path", () => {
  const src = readFileSync(join(root, "app/lib/nytStates.mjs"), "utf8");
  assert.doesNotMatch(src, /Dropbox|TELEGRAM|\/home\/areveur/);
});
