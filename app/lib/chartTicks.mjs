/**
 * Choose x-axis tick indexes so labels stay at least `minGap` pixels apart
 * (viewBox units). Prefers first + last, then time-even candidates.
 */
export function candidateTickIndexes(pts, xAt, maxTicks) {
  if (!pts.length) return [];
  const last = pts.length - 1;
  if (last === 0) return [0];
  const timed = pts.every((p) => p.ms != null);
  const tmin = timed ? Math.min(...pts.map((p) => p.ms)) : 0;
  const tmax = timed ? Math.max(...pts.map((p) => p.ms)) : last;
  const n = Math.max(2, Math.min(maxTicks, pts.length));
  const idxs = new Set([0, last]);
  for (let k = 1; k < n - 1; k++) {
    if (timed && tmax > tmin) {
      const target = tmin + (k / (n - 1)) * (tmax - tmin);
      let best = 0;
      let bestD = Infinity;
      pts.forEach((p, i) => {
        const d = Math.abs(p.ms - target);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      idxs.add(best);
    } else {
      idxs.add(Math.round((k * last) / (n - 1)));
    }
  }
  return [...idxs].sort((a, b) => a - b);
}

export function spaceTickIndexes(pts, xAt, indexes, minGap) {
  if (!indexes.length) return [];
  const xs = indexes.map((i) => ({ i, x: xAt(pts[i], i) }));
  const first = xs[0];
  const last = xs[xs.length - 1];
  if (xs.length === 1) return [first.i];
  if (last.x - first.x < minGap) return [first.i];
  const kept = [first];
  for (let k = 1; k < xs.length - 1; k++) {
    if (xs[k].x - kept[kept.length - 1].x >= minGap) kept.push(xs[k]);
  }
  if (last.x - kept[kept.length - 1].x >= minGap) {
    kept.push(last);
  } else if (kept.length > 1 && last.x - kept[kept.length - 2].x >= minGap) {
    kept[kept.length - 1] = last;
  } else {
    kept.push(last);
    while (kept.length > 2 && kept[kept.length - 1].x - kept[kept.length - 2].x < minGap) {
      kept.splice(kept.length - 2, 1);
    }
  }
  return kept.map((k) => k.i);
}

export function pickXTickIndexes(pts, xAt, { maxTicks = 6, minGap = 120 } = {}) {
  return spaceTickIndexes(pts, xAt, candidateTickIndexes(pts, xAt, maxTicks), minGap);
}
