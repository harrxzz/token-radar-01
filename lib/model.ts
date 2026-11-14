// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and may add
// pre-token protocols below the watchlist floor: the early rows the radar exists to find. A protocol is
// pre-token when its index entry records no token (no market cap, no CoinGecko id, no symbol); the
// snapshot's live-token protocols are kept apart and shown as the market's own values, never mixed into
// the ranked board.
//
// V2 estimates market-cap/TVL from live-token category peers, with a global fallback.
// Multipliers are heuristic adjustments, not a prediction of a token or airdrop.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.25,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: ModelBreakdown;
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  model: ModelBreakdown;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

export interface ModelBreakdown {
  comparable_multiple: number;
  comparable_count: number;
  comparable_scope: string;
  growth_pct: number;
  growth_multiplier: number;
  instability_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  chain_prior_multiplier: number;
  category_multiplier: number;
  age_days: number | null;
}

/** Median peer market-cap/TVL, winsorized to prevent a single extreme driving the estimate. */
export function comparableFor(p: SnapshotProtocol, protocols: SnapshotProtocol[]): { multiple: number; count: number; scope: string } {
  const peers = protocols.filter(q => !isPreToken(q) && q.mcap_usd !== null && q.mcap_usd > 0 && q.tvl_usd > 0 && q.category !== 'CEX');
  const category = peers.filter(q => q.category === p.category && p.category !== null);
  const selected = category.length >= 3 ? category : peers;
  const ratios = selected.map(q => Math.min(2, Math.max(0.02, q.mcap_usd! / q.tvl_usd))).sort((a,b) => a-b);
  const mid = Math.floor(ratios.length / 2);
  const multiple = ratios.length ? (ratios.length % 2 ? ratios[mid]! : (ratios[mid-1]! + ratios[mid]!) / 2) : 0.25;
  return { multiple, count: ratios.length, scope: category.length >= 3 ? 'category' : ratios.length ? 'global fallback' : 'fixed fallback' };
}

export function impliedValue(protocol: SnapshotProtocol, asOf: string, model: ModelConstants, protocols: SnapshotProtocol[] = []): { implied: number; breakdown: ModelBreakdown } {
  const age = ageDays(asOf, protocol.listed_at);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(protocol.change_7d, 0)));
  // Saturates smoothly: extreme weekly TVL changes cannot dominate value.
  const growthMult = 1 + 0.2 * Math.tanh(growthPct / 40);
  // Absolute net change is a rough instability proxy, not measured volatility.
  const instabilityMult = 1 - 0.15 * Math.min(Math.abs(growthPct) / 120, 1);
  // Triangle peaking at one year and returning to the floor after three years.
  const modeledAge = Math.max(age ?? model.unknown_age_days, 0);
  const maturityMult = model.maturity_floor + model.maturity_range * Math.max(0, Math.min(modeledAge / 365, (1095 - modeledAge) / 730));
  const chainMult = 1 + Math.min(Math.max(new Set(protocol.chains).size - 1, 0), 4) * 0.025;
  // Explicit subjective first-listed-chain priors, not empirical estimates.
  const chainPriors: Record<string, number> = { Ethereum: 1.05, Solana: 0.95 };
  const chainPriorMult = chainPriors[protocol.chains[0] ?? ''] ?? 1;
  const c = (protocol.category ?? '').toLowerCase();
  const categoryMult = /lend|dex|derivative/.test(c) ? 1.05 : /bridge|staking|stable/.test(c) ? 0.9 : 1;
  const comp = comparableFor(protocol, protocols);
  const breakdown = { comparable_multiple: comp.multiple, comparable_count: comp.count, comparable_scope: comp.scope, growth_pct: growthPct, growth_multiplier: growthMult, instability_multiplier: instabilityMult, maturity_multiplier: maturityMult, chain_multiplier: chainMult, chain_prior_multiplier: chainPriorMult, category_multiplier: categoryMult, age_days: age };
  const implied = Math.max(1, Math.round(protocol.tvl_usd * comp.multiple * growthMult * instabilityMult * maturityMult * chainMult * chainPriorMult * categoryMult));
  return { implied, breakdown };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a replacement
  // for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const { implied, breakdown } = impliedValue(p, snapshot.as_of, model, snapshot.protocols);
    return { p, implied, breakdown };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.breakdown.age_days,
    implied_value_usd: s.implied,
    model: s.breakdown,
    farm_steps: farmSteps(s.p, s.breakdown.age_days).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** Plans are hypotheses: the snapshot does not verify products, eligibility, fees or rewards. */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = p.chains[0] ?? 'the supported chain';
  const gas = chain === 'Ethereum' ? '$5–30' : chain === 'Solana' ? 'under $1' : '$0.10–5';
  const capital = p.tvl_usd >= 1_000_000_000 ? 150 : p.tvl_usd >= 100_000_000 ? 100 : 50;
  const hold = age !== null && age < 180 ? 60 : 30;
  const c = (p.category ?? '').toLowerCase();
  let action = `Inspect ${p.name}'s official app on ${chain}; only use a documented product if accessible, otherwise skip.`;
  let repeat = 'Review your position and record any eligible activity; do not churn transactions just to farm.';
  if (/lend|collateral|cdp/.test(c)) { action = `If supported, supply up to $${capital} of a documented asset to ${p.name} on ${chain}; avoid borrowing until risks are understood.`; repeat = 'Review collateral and utilization weekly; withdraw if risk or terms change.'; }
  else if (/dex|liquidity/.test(c)) { action = `If supported, swap up to $${capital} on ${p.name} on ${chain}; inspect slippage and route before confirming.`; repeat = 'Review the swap and, only if useful, make a small reverse swap; avoid unnecessary volume.'; }
  else if (/yield|farm|curator|allocator/.test(c)) { action = `If supported, deposit up to $${capital} in a documented ${p.name} vault on ${chain}; review withdrawal limits first.`; repeat = 'Review vault performance, fees and withdrawal availability weekly.'; }
  else if (/bridge/.test(c)) { action = `If supported, bridge up to $${capital} through ${p.name} to ${chain}; verify both networks and the destination address.`; repeat = 'Check bridge completion and finality before moving funds again.'; }
  else if (/derivative|perpetual|option/.test(c)) { action = `If supported, deposit up to $${capital} to ${p.name} on ${chain} and inspect the smallest unleveraged or low-risk market; skip if unavailable.`; repeat = 'Review margin and liquidation risk weekly; close any unwanted exposure.'; }
  else if (/staking|restak/.test(c)) { action = `If supported, stake up to $${capital} of the required asset through ${p.name} on ${chain}; check lockup and slashing risks.`; repeat = 'Check staking status and any unbonding queue weekly.'; }
  return [
    { text: `Check ${p.name}'s official documentation for ${chain}, geographic restrictions and a current rewards program. No airdrop or eligibility is assumed.`, cost: '$0', time: '10 minutes' },
    { text: `Prepare a dedicated wallet for ${chain}, verify the official app and fund only the amount you can afford to lose.`, cost: `network fees estimated ${gas} per transaction`, time: '10 minutes' },
    { text: action, cost: `up to $${capital} at risk plus estimated ${gas} network fee; product and slippage fees may apply`, time: '15 minutes' },
    { text: repeat, cost: `estimated ${gas} per transaction if needed`, time: '10 minutes weekly' },
    { text: `After ${hold} days, reassess risks and withdraw if appropriate; holding does not guarantee a snapshot or reward.`, cost: `up to $${capital} remains exposed plus estimated ${gas} to exit`, time: `${hold} days plus 10 minutes to exit` },
    { text: `Log transaction dates and verify any reward claim only in official documentation; never disclose your seed phrase.`, cost: '$0 to check; claim fees vary', time: '5 minutes' },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    model: row.model,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
