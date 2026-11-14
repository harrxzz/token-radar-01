import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { impliedValue, MODEL } from './lib/model.ts';

const p = { slug: 'test', name: 'Test', category: null, chains: ['Ethereum'], tvl_usd: 1000000, change_7d: 0, mcap_usd: null, listed_at: '2024-01-01', gecko_id: null, symbol: null };
const score = (changes: Partial<typeof p>) => impliedValue({ ...p, ...changes }, '2025-01-01', MODEL).breakdown;

test('age peaks at one year and falls for both new and old protocols', () => {
  const peak = score({listed_at: '2024-01-02'}).maturity_multiplier;
  assert.ok(peak > score({listed_at: '2025-01-01'}).maturity_multiplier);
  assert.ok(peak > score({listed_at: '2020-01-01'}).maturity_multiplier);
});
test('same breadth but different chains receive distinct priors', () => {
  assert.notEqual(score({chains:['Ethereum']}).chain_prior_multiplier, score({chains:['Solana']}).chain_prior_multiplier);
});
test('large absolute changes receive an instability discount, not observed volatility', () => {
  assert.ok(score({change_7d: 100}).instability_multiplier < score({change_7d: 0}).instability_multiplier);
  assert.ok(score({change_7d: -60}).instability_multiplier < score({change_7d: 0}).instability_multiplier);
});
