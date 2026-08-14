# ElectionTrace

National precinct-anomaly explorer. The same detectors run in every state. Open a map, a table, and a proof-of-work packet for each flag.

```
media/*.geojson.gz  →  index  →  map + table + night-of charts
```

## Quick start

Needs [Node.js 20+](https://nodejs.org/).

```bash
git clone https://github.com/YOU/ElectionTrace.git
cd ElectionTrace
npm install
npm start
```

Open [http://127.0.0.1:5200](http://127.0.0.1:5200). With no extra files, the committed **sample** (a few precincts in Pennsylvania) is enough to click through the UI.

```bash
npm test          # detectors + UI contracts
npm run index     # rebuild the index without serving
```

### Docker

```bash
docker compose up --build
```

Same URL. Sample data is used until you add a full extract under `media/`.

## Full 2020 extract

The lab file is ~264 MB and is **not** in git. After you publish a GitHub Release (see [`docs/DATA.md`](docs/DATA.md)):

```bash
./scripts/fetch-data.sh https://github.com/YOU/ElectionTrace/releases/download/data-2020/electiontrace-data.tar.gz
npm start
```

Or copy your own `*.geojson.gz` into `media/` and optional night files into `media/nyt-election-data/`.

## What it flags

Every rule is listed in the app under **Methods** and in `app/lib/methods.mjs`. Density and size tails are computed **inside each state**, then the same cutoffs apply everywhere.

Over-time rules (`vote_transfer`, `count_retraction`, `one_sided_increment`) stay quiet unless the Feature has `votes_*_prev` or a `history` array.

## HTTP API

| | |
|--|--|
| `GET /api/health` | `{ ok, ready, indexing, precincts, flagged }` |
| `GET /api/summary` | National counts, per-state tallies, Benford |
| `GET /api/methods` | Detector definitions |
| `GET /api/anomalies?state=06&type=density_spike&q=` | Paged rows |
| `GET /api/anomalies.geojson?...` | Point GeoJSON for the map |
| `GET /api/precincts/:geoid` | One precinct |
| `GET /api/precincts/:geoid/workup` | Proof-of-work packet |
| `GET /api/race?state=42&county=42001` | Night-file race + county |
| `GET /api/county-winners` | County presidential winners |

## Configuration

Copy `.env.example` to `.env` only if you need to change defaults. **Do not commit `.env`.**

| Variable | Default | Purpose |
|--|--|--|
| `PORT` | `5200` | Listen port |
| `HOST` | `0.0.0.0` | Bind address |
| `MEDIA_DIR` | `./media` (or `./media/sample`) | Precinct GeoJSON |
| `DATA_DIR` | `./data` | Generated index |
| `NYT_STATES_DIR` | `./media/nyt-election-data` | Night files |
| `DATABASE_URL` | unset | Optional Postgres |
| `HTTPS_KEY` / `HTTPS_CERT` | unset | Optional TLS |

JSONL under `data/` is the default store. Postgres is optional.

## Layout

```
app/lib/methods.mjs   detectors
app/lib/scan.mjs      streams geojson.gz
app/lib/index.mjs     builds data/precincts.jsonl
app/server.mjs        API + static UI
app/public/           map + table
media/sample/         tiny demo (committed)
media/                your extract (not committed)
data/                 generated index (not committed)
docs/DATA.md          how to publish / fetch a data pack
```

## License

MIT. Third-party election extracts are **not** covered by that license — see [`docs/DATA.md`](docs/DATA.md).
