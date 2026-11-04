'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { remainingBuildBatch, materialCounts } = require('../src/build-batch');
const { buildVerification } = require('../src/persona-build');
const { buildCellComplete } = require('../src/build-blocks');

function fixture(observed, { original = 'dirt', originalState = 10, floor = 65, properties } = {}) {
  const cell = { x: 0, y: 65, z: 0, material: 'cobblestone', ...(properties ? { properties } : {}) };
  const blueprint = {
    origin: { x: 0, y: floor, z: 0 }, blocks: [cell], empty: [],
    initialNames: { '0,65,0': original }, initialBlocks: { '0,65,0': originalState },
  };
  const goal = { personaGoalId: 'lease', kind: 'build', blueprint };
  const bot = { blockAt: p => p.equals(new Vec3(0, 65, 0)) ? observed && { position: p, ...observed }
    : { name: 'stone', stateId: 1, boundingBox: 'block', position: p } };
  return { bot, goal, cell, batch: { cells: [cell] } };
}

test('persona batching keeps every buried mismatch rejected by final verification as material work', () => {
  const cases = [
    { observed: { name: 'air', stateId: 0, boundingBox: 'empty' } },
    { observed: { name: 'diamond_block', stateId: 11, boundingBox: 'block' } },
    { observed: { name: 'dirt', stateId: 12, boundingBox: 'block' } },
    { observed: { name: 'dirt', stateId: 10, boundingBox: 'block' }, floor: 64 },
    { observed: { name: 'dirt', stateId: 10, boundingBox: 'block' }, properties: { facing: 'north' } },
    { observed: null },
  ];
  for (const { observed, ...options } of cases) {
    const { bot, goal, cell, batch } = fixture(observed, options);
    assert.equal(buildVerification(bot, goal).verified, false);
    assert.deepEqual(remainingBuildBatch(bot, batch, goal), [cell], JSON.stringify({ observed, ...options }));
    assert.deepEqual(materialCounts(remainingBuildBatch(bot, batch, goal)), [{ item: 'cobblestone', count: 1 }]);
  }
});

test('persona batching accepts only exact material or recorded enclosed natural foundation', () => {
  for (const observed of [
    { name: 'cobblestone', stateId: 20, boundingBox: 'block' },
    { name: 'dirt', stateId: 10, boundingBox: 'block' },
  ]) {
    const { bot, goal, batch } = fixture(observed);
    assert.equal(buildVerification(bot, goal).verified, true);
    assert.deepEqual(remainingBuildBatch(bot, batch, goal), []);
  }
});

test('ordinary upstream build batching retains its enclosed-cell semantics', () => {
  const { bot, cell, batch } = fixture({ name: 'air', stateId: 0, boundingBox: 'empty' });
  assert.equal(buildCellComplete(bot, cell), true);
  assert.deepEqual(remainingBuildBatch(bot, batch), []);
  assert.deepEqual(remainingBuildBatch(bot, batch, { kind: 'build' }), []);
});
