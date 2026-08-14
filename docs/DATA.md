# Data packs

ElectionTrace is the **app**. The national 2020 extract is too large for git (GitHub’s file limit is 100 MB; the lab precinct file is ~264 MB). Night-of state JSON is also kept out of the repository.

## What the app expects

| Path | What it is |
|--|--|
| `media/*.geojson` or `media/*.geojson.gz` | Precinct features (indexed on first start) |
| `media/nyt-election-data/*.json` | Optional NYT/Edison 2020 night files (51 states + DC) |

Field list: [`media/README.md`](../media/README.md).

## Out of the box (no download)

`media/sample/` ships with a handful of synthetic precincts and one demo night file. If you have not added a full extract, `npm start` and Docker use that sample automatically.

## Full lab extract (recommended for a real session)

The pack is on the [`data-2020`](https://github.com/areveur51/ElectionTrace/releases/tag/data-2020) GitHub Release (`electiontrace-data.tar.gz`: national precincts + 51 night-of state files).

```bash
./scripts/fetch-data.sh
npm start
```

To rebuild or re-publish the pack from a machine that already has the files:

```bash
./scripts/package-data.sh
# → dist/electiontrace-data.tar.gz
```

Do **not** put secrets, `.env`, or TLS keys in the tarball. The pack script only copies GeoJSON and night JSON from `media/`.

Override the URL if needed: `./scripts/fetch-data.sh https://…/electiontrace-data.tar.gz`

Restart the app so it reindexes.

To re-check a proof SHA after you have the pack: [`REPRODUCE.md`](REPRODUCE.md).

## Docker

```bash
./scripts/fetch-data.sh   # optional; sample is used if you skip this
docker compose up --build
```

`./media` and `./data` are bind-mounted so the index persists.

## Postgres (optional)

JSONL under `data/` is the default. To use Postgres, copy `.env.example` to `.env` and set `DATABASE_URL` to your own URL. Never commit `.env`.

## Licensing the data

The **code** is MIT. The national precinct extract and NYT night files are **third-party**. Host them in a Release only if you have the right to redistribute them. Users may also drop their own GeoJSON into `media/`.
