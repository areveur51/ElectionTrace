# Media (precinct GeoJSON)

Put one or more files here:

- `*.geojson.gz` (preferred)
- `*.geojson`

The committed [`sample/`](sample/) folder is used automatically when this directory has no extract.

ElectionTrace indexes every Feature. Properties expected on each precinct:

| Field | Meaning |
|--|--|
| `GEOID` | Precinct id. First two digits are the state FIPS (`06` = California). |
| `votes_dem` | Democratic votes |
| `votes_rep` | Republican votes |
| `votes_total` | All reported votes |
| `votes_per_sqkm` | Vote density |
| `pct_dem_lead` | Democratic lead in percentage points (−100 … 100) |
| `year` / `election_year` / `cycle` | Election year. Sets default candidate names. |
| `candidate_dem` / `candidate_rep` | Optional nominee name overrides. |

Optional prior-report fields (enable the over-time detectors):

| Field | Meaning |
|--|--|
| `votes_dem_prev` / `votes_rep_prev` / `votes_total_prev` | Previous published counts |
| `history` / `reports` / `snapshots` | Array of `{ ts, votes_dem, votes_rep, votes_total }` |

Geometry may be `Polygon`, `MultiPolygon`, or `Point` (WGS84). The indexer stores a centroid for the map.

Optional NYT election-night files (candidate names + reporting timeseries):

Put per-state JSON in `nyt-election-data/` (e.g. `pennsylvania.json`). Those load without reindexing.

The national lab extract (`precincts-with-results.geojson.gz`, ~264 MB) is **not** committed. Night-of state JSON in `nyt-election-data/` enables retractions, implied vote-switches, lead changes, and one-sided dumps. Fetch the [`data-2020`](https://github.com/areveur51/ElectionTrace/releases/tag/data-2020) pack:

```bash
./scripts/fetch-data.sh
```

Details: [`docs/DATA.md`](../docs/DATA.md).

```bash
npm run index
```
