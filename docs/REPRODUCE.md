# Reproduce a proof

The SHA-256 on **View JSON** is a checksum of that **detector packet**. It is not a hash of the NYT GeoJSON, not a signature from a county, and not a verdict that the detectors are the right rules.

Same extract, same item, same workup → same SHA.

## What is hashed

| Packet `kind` | What goes into the digest |
|--|--|
| `electiontrace.workup` | Precinct GEOID, published vote fields, state thresholds, flags, and checks. Then `candidates` and `history` are added and that object is hashed. |
| `electiontrace.feed-workup` | Night-of / file rule, inputs from the state JSON, and pass/fail checks (keys sorted). |
| `electiontrace.table-workup` | A table of those item packets. |
| `electiontrace.coverage-workup` | Which states have precinct geometry vs night files. |

The published `sha256` field is **not** included in the bytes that were hashed. Compare the field. Do not `sha256sum` the downloaded JSON file.

## 1. Same files

```bash
git clone https://github.com/areveur51/ElectionTrace.git
cd ElectionTrace
npm install
./scripts/fetch-data.sh
npm start
```

That pulls the [`data-2020`](https://github.com/areveur51/ElectionTrace/releases/tag/data-2020) pack into `media/`. Wait until `GET http://127.0.0.1:5200/api/health` shows `"ready": true`.

A different extract, a rebuilt index from a different file, or a different app version can change the digest even if the GEOID is the same.

## 2. Precinct lab

In the UI: open the precinct → **View JSON** → compare `sha256`.

Or:

```bash
curl -sS "http://127.0.0.1:5200/api/precincts/42001002000/workup" | python3 -c "import json,sys; print(json.load(sys.stdin)['sha256'])"
```

Use the GEOID from the packet. Compare that hex string to the digest in the JSON you downloaded.

## 3. Night-of and In the files

There is no per-item URL. Open the same card (same state, same rule) and click **View JSON** again. Compare `sha256`.

Those packets hash the night-file inputs (timestamps, implied votes, county vs state totals) and the detector checks, not the raw `pennsylvania.json` bytes.

`feed_vote_switch` is the night-of form of precinct `vote_transfer`: opposite implied moves of 5,000 or more, leftover and Δtotal within 1,000 of that 5,000-vote band. Compare `sha256` on **Implied votes moved between candidates**.

## 4. Coverage

On **Coverage**, open the proof JSON. The digest is over the expected 51 jurisdictions vs which precinct and night files are present.

## Why a SHA might not match

- Different data pack or a file you copied yourself
- Index not finished, or `data/` left over from another extract
- App code newer or older than the packet’s `version`
- You hashed the whole downloaded file, including the `sha256` key
