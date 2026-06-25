// Keyless market + sports data for the new-tab page.
//
// Stocks: Yahoo Finance's public chart endpoint (no key) — same base
// media-streamer's /finance uses. Sports: ESPN's public scoreboard (no key).
// Both are fetched directly: the extension's host_permissions (https://*/*)
// grant cross-origin reads, so no backend and no API keys are needed (we never
// ship our paid Finnhub/Alpaca keys in a public extension).

const Y_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart/';

export async function fetchQuote(symbol) {
  const url = `${Y_CHART}${encodeURIComponent(symbol)}?range=1d&interval=1d`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('quote ' + res.status);
  const m = (await res.json())?.chart?.result?.[0]?.meta;
  if (!m || m.regularMarketPrice == null) throw new Error('no data');
  const price = m.regularMarketPrice;
  const prev = m.chartPreviousClose ?? m.previousClose ?? price;
  return {
    symbol: m.symbol || symbol,
    price,
    changePct: prev ? ((price - prev) / prev) * 100 : 0,
    currency: m.currency || 'USD',
  };
}

export async function fetchQuotes(symbols) {
  return Promise.all(symbols.map(async (s) => {
    try { return await fetchQuote(s); }
    catch { return { symbol: s, error: true }; }
  }));
}

// ESPN league key -> sport/league path.
export const LEAGUES = {
  nfl: 'football/nfl',
  ncaaf: 'football/college-football',
  nba: 'basketball/nba',
  wnba: 'basketball/wnba',
  ncaam: 'basketball/mens-college-basketball',
  mlb: 'baseball/mlb',
  nhl: 'hockey/nhl',
  mls: 'soccer/usa.1',
  epl: 'soccer/eng.1',
  ucl: 'soccer/uefa.champions',
};

export async function fetchScores(leagueKey) {
  const path = LEAGUES[leagueKey];
  if (!path) return { league: leagueKey, games: [], error: 'unknown league' };
  try {
    const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard`);
    if (!res.ok) throw new Error('espn ' + res.status);
    const data = await res.json();
    const games = (data.events || []).slice(0, 6).map((e) => {
      const cs = e.competitions?.[0]?.competitors || [];
      const home = cs.find((c) => c.homeAway === 'home');
      const away = cs.find((c) => c.homeAway === 'away');
      const team = (c) => (c ? { abbr: c.team?.abbreviation || c.team?.shortDisplayName || '?', score: c.score } : null);
      return {
        name: e.shortName,
        state: e.status?.type?.state,         // 'pre' | 'in' | 'post'
        detail: e.status?.type?.shortDetail,  // "9/9 - 8:20 PM EDT" | "Final"
        home: team(home),
        away: team(away),
      };
    });
    return { league: leagueKey, games };
  } catch (e) {
    return { league: leagueKey, games: [], error: e.message };
  }
}

export async function fetchAllScores(leagueKeys) {
  return Promise.all(leagueKeys.map((k) => fetchScores(k)));
}
