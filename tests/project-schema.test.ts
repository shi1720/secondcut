import test from 'node:test';
import assert from 'node:assert/strict';
import { maskSchema, projectSchema } from '../lib/project-schema';
const fixture = () => ({
  name: 'Leather sample', image: '/demo/leather.png', widthMm: 300, clearanceMm: 2, gapMm: 2,
  mask: { width: 16, height: 16, runs: [0, 256] }, exclusions: [{ x: .7, y: .7, r: .03 }],
  patterns: [{ id: 'tag', name: 'Bag tag', widthMm: 40, heightMm: 60, quantity: 4, value: 100, shape: 'rectangle', rotate: true }],
  reviewed: true, model: 'SlimSAM', points: [{ x: .5, y: .5, label: 1 }],
});
test('valid project normalizes name, defaults currency, drops plan and stores source rather than computed layout', () => {
  const parsed = projectSchema.parse({ ...fixture(), name: '  Leather sample  ', plan: { unknown: Infinity } });
  assert.equal(parsed.name, 'Leather sample'); assert.equal(parsed.currency, 'INR'); assert.equal('plan' in parsed, false);
});
test('mask RLE must be integer, bounded, cover pixels exactly and contain foreground', () => {
  assert.equal(maskSchema.safeParse({ width: 16, height: 16, runs: [10, 30, 216] }).success, true);
  for (const mask of [{ width: 16, height: 16, runs: [256] }, { width: 16, height: 16, runs: [0, 255] }, { width: 16, height: 16, runs: [1, 0, 255] }, { width: 16, height: 16, runs: [0, 256.1] }, { width: 2048, height: 16, runs: [0, 32768] }, { width: 16, height: 16, runs: [-1, 257] }]) assert.equal(maskSchema.safeParse(mask).success, false);
});
test('project rejects nonfinite scale, margins, exclusions, points and pattern dimensions', () => {
  for (const change of [{ widthMm: Infinity }, { widthMm: 49 }, { gapMm: -1 }, { clearanceMm: 31 }, { exclusions: [{ x: NaN, y: .5, r: .1 }] }, { points: [{ x: .5, y: .5, label: 2 }] }]) assert.equal(projectSchema.safeParse({ ...fixture(), ...change }).success, false);
  const data = fixture(); data.patterns[0].heightMm = NaN; assert.equal(projectSchema.safeParse(data).success, false);
});
test('project accepts only known demo files or opaque uploaded photo paths', () => {
  for (const image of ['https://example.test/source.png', '/demo/../secret', '/demo/unknown.png', '/api/photos/other', 'data:image/png;base64,AA']) assert.equal(projectSchema.safeParse({ ...fixture(), image }).success, false);
  const image = `/api/photos/${'a'.repeat(64)}_00000000-0000-4000-8000-000000000000`;
  assert.equal(projectSchema.safeParse({ ...fixture(), image }).success, true);
});
test('duplicate and reserved pattern IDs, zero quantities and excessive total pieces fail', () => {
  const data = fixture();
  assert.equal(projectSchema.safeParse({ ...data, patterns: [data.patterns[0], data.patterns[0]] }).success, false);
  for (const change of [{ id: '__proto__' }, { quantity: 0 }, { quantity: 31 }, { value: Infinity }, { shape: 'polygon' }]) assert.equal(projectSchema.safeParse({ ...data, patterns: [{ ...data.patterns[0], ...change }] }).success, false);
  assert.equal(projectSchema.safeParse({ ...data, patterns: [0, 1, 2, 3].map(i => ({ ...data.patterns[0], id: `p${i}`, quantity: 30 })) }).success, false);
});
