#!/usr/bin/env node
import path from "path";
import { fileURLToPath } from "url";
import { buildIndex, resolveMediaDir } from "../app/lib/index.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mediaDir = resolveMediaDir(
  root,
  process.env.MEDIA_DIR ? path.resolve(process.env.MEDIA_DIR) : path.join(root, "media"),
);
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(root, "data");

console.log(`[index] media=${mediaDir}`);
console.log(`[index] data=${dataDir}`);
const { meta } = await buildIndex(mediaDir, dataDir, {
  onFile: (f) => console.log(`[index] scanning ${f}`),
  onProgress: (p) => {
    if (p.scanned % 25000 === 0) {
      console.log(`[index] ${p.file} scanned=${p.scanned} stored=${p.stored}`);
    }
  },
});
console.log(
  `[index] done precincts=${meta.precincts} flagged=${meta.flagged} states=${meta.states.length}`,
);
