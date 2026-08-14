/**
 * Stream a GeoJSON FeatureCollection (optionally gzipped) and emit
 * precinct rows: properties + centroid/bbox from coordinates.
 * Does not load the file into memory.
 */
import fs from "fs";
import zlib from "zlib";
import { stateFromGeoid } from "./fips.mjs";
import { normalizeHistory, resolveCandidates, resolveYear } from "./candidates.mjs";

function extractObject(buf, start) {
  if (start < 0 || start >= buf.length || buf[start] !== 123) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < buf.length; i++) {
    const c = buf[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === 92) esc = true;
      else if (c === 34) inStr = false;
      continue;
    }
    if (c === 34) inStr = true;
    else if (c === 123) depth += 1;
    else if (c === 125) {
      depth -= 1;
      if (depth === 0) {
        return { text: buf.toString("utf8", start, i + 1), end: i + 1 };
      }
    }
  }
  return null;
}

function findByte(buf, seq, from) {
  return buf.indexOf(seq, from);
}

/** Index of the byte after the matching closing bracket, or -1 if incomplete. */
export function closeBracket(buf, start) {
  if (start < 0 || start >= buf.length || buf[start] !== 91) return -1;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < buf.length; i++) {
    const c = buf[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === 92) esc = true;
      else if (c === 34) inStr = false;
      continue;
    }
    if (c === 34) inStr = true;
    else if (c === 91) depth += 1;
    else if (c === 93) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * Average only complete lon/lat pairs inside the coordinates array.
 * Do not read past `until` — that used to leak the next feature's vote
 * counts (79, 366, 54.2…) into the centroid and park Arkansas in the ocean.
 */
function scanNumbers(buf, from, until) {
  let sx = 0;
  let sy = 0;
  let n = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let i = from;
  let pair = [];
  while (i < until) {
    const c = buf[i];
    const startNum =
      (c >= 48 && c <= 57) ||
      c === 45 ||
      c === 46;
    if (!startNum) {
      i += 1;
      continue;
    }
    let j = i;
    if (buf[j] === 45) j += 1;
    while (
      j < until &&
      ((buf[j] >= 48 && buf[j] <= 57) ||
        buf[j] === 46 ||
        buf[j] === 101 ||
        buf[j] === 69 ||
        buf[j] === 43)
    ) {
      j += 1;
    }
    const v = Number(buf.toString("utf8", i, j));
    i = j;
    if (!Number.isFinite(v)) continue;
    pair.push(v);
    if (pair.length === 2) {
      const x = pair[0];
      const y = pair[1];
      pair = [];
      // WGS84 lon/lat. Extra filter: US-lab extract should stay in the Americas.
      if (x < -180 || x > 180 || y < -90 || y > 90) continue;
      sx += x;
      sy += y;
      n += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!n) return null;
  const lng = sx / n;
  const lat = sy / n;
  // Vertex mean dragged by a bad pair still happens if we leaked integers;
  // drop centroids that are not on the North American plate for US FIPS.
  return { lng, lat, bbox: [minX, minY, maxX, maxY], vertices: n };
}

/** True if a point is on the US (CONUS / AK / HI / PR) map. */
export function isUsPoint(lat, lng) {
  if (lat == null || lng == null) return false;
  if (lat >= 24 && lat <= 50 && lng >= -125 && lng <= -66) return true;
  if (lat >= 51 && lat <= 72 && lng >= -180 && lng <= -129) return true;
  if (lat >= 18 && lat <= 23 && lng >= -161 && lng <= -154) return true;
  if (lat >= 17 && lat <= 19 && lng >= -68 && lng <= -65) return true;
  return false;
}

function pickProp(props, keys) {
  for (const k of keys) {
    if (props[k] !== undefined && props[k] !== null && props[k] !== "") return props[k];
  }
  return null;
}

function prevFromHistory(props) {
  const hist = props.history || props.reports || props.snapshots || props.timeseries;
  if (!Array.isArray(hist) || hist.length < 2) return null;
  const scored = hist.map((h, i) => ({
    order:
      Date.parse(h?.ts || h?.time || h?.reported_at || h?.date || "") || i,
    votes_dem: h?.votes_dem ?? h?.dem,
    votes_rep: h?.votes_rep ?? h?.rep,
    votes_total: h?.votes_total ?? h?.total,
  }));
  scored.sort((a, b) => a.order - b.order);
  return scored[scored.length - 2];
}

function toRow(props, geom) {
  const geoid = String(props.GEOID || props.geoid || props.id || "");
  const st = stateFromGeoid(geoid);
  const histPrev = prevFromHistory(props);
  const votes_dem_prev =
    pickProp(props, ["votes_dem_prev", "votes_dem_prior", "prev_votes_dem"]) ??
    histPrev?.votes_dem ??
    null;
  const votes_rep_prev =
    pickProp(props, ["votes_rep_prev", "votes_rep_prior", "prev_votes_rep"]) ??
    histPrev?.votes_rep ??
    null;
  const votes_total_prev =
    pickProp(props, ["votes_total_prev", "votes_total_prior", "prev_votes_total"]) ??
    histPrev?.votes_total ??
    null;
  const names = resolveCandidates({ props });
  const current = {
    votes_dem: props.votes_dem ?? null,
    votes_rep: props.votes_rep ?? null,
    votes_total: props.votes_total ?? null,
    votes_dem_prev,
    votes_rep_prev,
    votes_total_prev,
  };
  return {
    geoid,
    stateFips: st.fips,
    stateName: st.name,
    countyFips: st.countyFips,
    votes_dem: current.votes_dem,
    votes_rep: current.votes_rep,
    votes_total: current.votes_total,
    votes_per_sqkm: props.votes_per_sqkm ?? null,
    pct_dem_lead: props.pct_dem_lead ?? null,
    votes_dem_prev,
    votes_rep_prev,
    votes_total_prev,
    candidate_dem: names.dem,
    candidate_rep: names.rep,
    election_year: resolveYear({ props }),
    history: normalizeHistory(props, current),
    lng: geom?.lng ?? null,
    lat: geom?.lat ?? null,
    bbox: geom?.bbox ?? null,
  };
}

const PROP_MARK = Buffer.from('"properties"');
const COORD_MARK = Buffer.from('"coordinates"');

/**
 * @param {string} filePath
 * @param {(row: object, n: number) => void} onRow
 * @param {{ onProgress?: (n: number) => void }} [opts]
 */
export async function scanGeojsonFile(filePath, onRow, opts = {}) {
  const onProgress = opts.onProgress || (() => {});
  const raw = createMaybeGzipStream(filePath);
  let carry = Buffer.alloc(0);
  let n = 0;
  for await (const chunk of raw) {
    let data = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    let pos = 0;
    while (true) {
      const p = findByte(data, PROP_MARK, pos);
      if (p < 0) {
        carry = data.subarray(Math.max(0, data.length - 32));
        break;
      }
      const brace = data.indexOf(123, p + PROP_MARK.length);
      if (brace < 0) {
        carry = data.subarray(p);
        break;
      }
      const obj = extractObject(data, brace);
      if (!obj) {
        carry = data.subarray(p);
        break;
      }
      let props;
      try {
        props = JSON.parse(obj.text);
      } catch {
        pos = obj.end;
        continue;
      }
      // Need enough buffer after properties to reach coordinates + a sample of verts.
      // If coordinates are missing in this buffer, hold from properties mark.
      const cAt = findByte(data, COORD_MARK, obj.end);
      let geom = null;
      if (cAt >= 0) {
        const bracket = data.indexOf(91, cAt + COORD_MARK.length);
        if (bracket >= 0) {
          const end = closeBracket(data, bracket);
          if (end < 0) {
            // Geometry not fully buffered yet — wait for more chunks.
            if (data.length - p > 12 * 1024 * 1024) {
              // Pathological feature; skip the map point rather than grow forever.
              pos = obj.end;
              geom = null;
            } else {
              carry = data.subarray(p);
              break;
            }
          }
          geom = scanNumbers(data, bracket, end);
          pos = end;
        } else if (data.length - obj.end < 64) {
          carry = data.subarray(p);
          break;
        } else {
          pos = obj.end;
        }
      } else if (data.length - obj.end < 128) {
        carry = data.subarray(p);
        break;
      } else {
        pos = obj.end;
      }
      const row = toRow(props, geom);
      if (row.stateFips && row.stateFips !== "?" && !isUsPoint(row.lat, row.lng)) {
        row.lat = null;
        row.lng = null;
        row.bbox = null;
      }
      n += 1;
      onRow(row, n);
      if (n % 5000 === 0) onProgress(n);
    }
  }
  return n;
}

function createMaybeGzipStream(filePath) {
  const stream = fs.createReadStream(filePath);
  if (filePath.endsWith(".gz")) {
    return stream.pipe(zlib.createGunzip());
  }
  return stream;
}

/** Build a tiny gzipped FeatureCollection for tests. */
export function featureCollectionToBuffer(features) {
  const json = JSON.stringify({ type: "FeatureCollection", features });
  return zlib.gzipSync(Buffer.from(json));
}

export async function scanGeojsonBuffer(buf, onRow) {
  let data = buf;
  if (buf[0] === 0x1f && buf[1] === 0x8b) data = zlib.gunzipSync(buf);
  const text = data;
  let pos = 0;
  let n = 0;
  while (true) {
    const p = findByte(text, PROP_MARK, pos);
    if (p < 0) break;
    const brace = text.indexOf(123, p + PROP_MARK.length);
    if (brace < 0) break;
    const obj = extractObject(text, brace);
    if (!obj) break;
    let props;
    try {
      props = JSON.parse(obj.text);
    } catch {
      pos = obj.end;
      continue;
    }
    const cAt = findByte(text, COORD_MARK, obj.end);
    let geom = null;
    let nextPos = obj.end;
    if (cAt >= 0) {
      const bracket = text.indexOf(91, cAt + COORD_MARK.length);
      if (bracket >= 0) {
        const end = closeBracket(text, bracket);
        if (end >= 0) {
          geom = scanNumbers(text, bracket, end);
          nextPos = end;
        }
      }
    }
    const row = toRow(props, geom);
    if (row.stateFips && row.stateFips !== "?" && !isUsPoint(row.lat, row.lng)) {
      row.lat = null;
      row.lng = null;
    }
    n += 1;
    onRow(row, n);
    pos = nextPos;
  }
  return n;
}
