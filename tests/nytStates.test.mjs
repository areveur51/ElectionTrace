import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { countyWinnerRow, countyWinners, parseStateRace, tallyByCountyWinner } from "../app/lib/nytStates.mjs";

describe("parseStateRace", () => {
  it("reads candidates and a timeseries from an NYT state payload", () => {
    const raw = {
      data: {
        races: [
          {
            state_id: "PA",
            state_name: "Pennsylvania",
            office: "President",
            election_date: "2020-11-03",
            votes: 1000,
            eevp: 90,
            leader_margin_name_display: "Biden +0.7",
            candidates: [
              {
                candidate_key: "bidenj",
                name_display: "Joseph R. Biden Jr.",
                last_name: "Biden",
                party_id: "democrat",
                votes: 510,
                percent: 51,
                winner: true,
              },
              {
                candidate_key: "trumpd",
                name_display: "Donald J. Trump",
                last_name: "Trump",
                party_id: "republican",
                votes: 490,
                percent: 49,
                winner: false,
              },
            ],
            counties: [{ fips: "42001", name: "Adams", votes: 100, results: { bidenj: 40, trumpd: 60 } }],
            timeseries: [
              { timestamp: "2020-11-04T00:00:00Z", votes: 100, eevp: 10, vote_shares: { bidenj: 0.4, trumpd: 0.6 } },
              { timestamp: "2020-11-04T06:00:00Z", votes: 1000, eevp: 90, vote_shares: { bidenj: 0.51, trumpd: 0.49 } },
            ],
          },
        ],
      },
    };
    const race = parseStateRace(raw);
    assert.equal(race.fips, "42");
    assert.equal(race.dem.name, "Joseph R. Biden Jr.");
    assert.equal(race.rep.last, "Trump");
    assert.equal(race.timeseries.length, 2);
    assert.equal(race.timeseries[1].votes_dem, 510);
    assert.equal(race.counties[0].name, "Adams");
    assert.ok(Array.isArray(race.findings.errors));
    assert.equal(race.findings.errors.filter((e) => e.kind === "county_vs_state").length, 1);
    const row = countyWinnerRow(race.counties[0], race);
    assert.equal(row.fips, "42001");
    assert.equal(row.winner, "Trump");
    assert.equal(row.winnerParty, "republican");
    assert.equal(row.repVotes, 60);
    assert.equal(row.demVotes, 40);
    const pack = countyWinners({ [race.fips]: race });
    assert.equal(pack.n, 1);
    assert.equal(pack.counties["42001"].winner, "Trump");
    assert.equal(pack.dem.last, "Biden");
    const tally = tallyByCountyWinner(
      [
        { countyFips: "42001", n: 3 },
        { countyFips: "42101", n: 2 },
        { countyFips: "", n: 1 },
      ],
      {
        42001: { winnerParty: "republican" },
        42101: { winnerParty: "democrat" },
      },
    );
    assert.equal(tally.dem, 2);
    assert.equal(tally.rep, 3);
    assert.equal(tally.other, 0);
    assert.equal(tally.unknown, 1);
    assert.equal(tally.total, 6);
    const voted = tallyByCountyWinner(
      [
        { countyFips: "42001", n: 1, votes_dem: 40, votes_rep: 60 },
        { countyFips: "42101", n: 1, votes_dem: 100, votes_rep: 20 },
      ],
      {
        42001: { winnerParty: "republican" },
        42101: { winnerParty: "democrat" },
      },
    );
    assert.deepEqual(voted.votes.dem, { plus: 140, minus: -80, net: 60 });
    assert.deepEqual(voted.votes.rep, { plus: 80, minus: -140, net: -60 });
  });
});
