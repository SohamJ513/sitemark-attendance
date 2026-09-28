import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceMeters, isValidCoord } from '../src/geo.js';

const SITE = { lat: 18.5204, lng: 73.8567 };

test('same point is 0 m away', () => {
  assert.ok(distanceMeters(SITE.lat, SITE.lng, SITE.lat, SITE.lng) < 0.001);
});

test('~0.001 deg latitude is about 111 m', () => {
  const d = distanceMeters(SITE.lat, SITE.lng, SITE.lat + 0.001, SITE.lng);
  assert.ok(d > 105 && d < 117, `got ${d}`);
});

test('geofence: inside vs outside a 150 m radius', () => {
  const inside = distanceMeters(SITE.lat, SITE.lng, SITE.lat + 0.001, SITE.lng);
  const outside = distanceMeters(SITE.lat, SITE.lng, SITE.lat + 0.003, SITE.lng);
  assert.ok(inside <= 150);
  assert.ok(outside > 150);
});

test('coordinate validation', () => {
  assert.equal(isValidCoord(18.5, 73.8), true);
  assert.equal(isValidCoord(91, 0), false);
  assert.equal(isValidCoord(NaN, 0), false);
});
