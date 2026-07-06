// Verifies the football-data client caches results (so we stay under the
// 10 req/min free-tier limit). Uses a MOCKED fetch — no real API calls.
// Run: `npx tsx scripts/football-cache.test.mjs`
process.env.FOOTBALL_DATA_API_KEY = process.env.FOOTBALL_DATA_API_KEY || 'test-key';
process.env.FOOTBALL_COMPETITIONS = 'PL'; // single competition → 1 fetch per refresh

let calls = 0;
globalThis.fetch = async () => {
  calls++;
  return {
    ok: true,
    json: async () => ({
      matches: [
        {
          id: 12345,
          utcDate: new Date(Date.now() + 86_400_000).toISOString(),
          status: 'TIMED',
          competition: { name: 'Premier League', code: 'PL' },
          homeTeam: { name: 'Arsenal' },
          awayTeam: { name: 'Chelsea' },
          score: { winner: null, fullTime: { home: null, away: null } },
        },
      ],
    }),
  };
};

const { getMatches } = await import('../backend/src/football.ts');

let failures = 0;
const assert = (c, m) => {
  console.log(`${c ? '  ✓' : '  ✗ FAIL:'} ${m}`);
  if (!c) failures++;
};

console.log('\n=== football cache test (mocked fetch) ===');
const first = await getMatches();
const afterFirst = calls;
assert(afterFirst === 1, `first getMatches() → 1 API call (got ${afterFirst})`);
assert(first.length === 1, `mapped ${first.length} match`);
assert(first[0].homeTeam === 'Arsenal' && first[0].awayTeam === 'Chelsea', 'match mapped correctly');
assert(first[0].status === 'TIMED', 'status passed through');

const second = await getMatches();
assert(calls === afterFirst, `second getMatches() served from cache → still ${calls} call(s)`);
assert(second.length === 1, 'cached result returned');

const third = await getMatches(true); // force bypasses cache
assert(calls === afterFirst + 1, `force-refresh makes a new call (${calls})`);

console.log(`\n=== ${failures === 0 ? 'ALL PASS ✅' : failures + ' FAILURE(S) ❌'} ===\n`);
process.exit(failures === 0 ? 0 : 1);
