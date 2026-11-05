'use strict';
const { ConstructionGoal } = require('./construction-access');
const { surveyRoute, navigate } = require('./skills');
const { checkAir } = require('./vitals');

// A nearby workstation can be sealed inside a building. Require a reachable,
// visible face before opening it, and try other observed stations without
// dismantling walls or spending the next recipe's ingredients as scaffolding.
async function selectWorkstation(bot, task, name, positions, approach, { operation = 'interact', eligible, attempt } = {}) {
  task.check(); checkAir(bot);
  const movement = bot.pathfinder.movements;
  const previous = Object.fromEntries(['canDig', 'allow1by1towers', 'scafoldingBlocks', 'countScaffoldingItems', 'getScaffoldingItem']
    .map(key => [key, movement[key]]));
  Object.assign(movement, { canDig: false, allow1by1towers: false, scafoldingBlocks: [],
    countScaffoldingItems: () => 0, getScaffoldingItem: () => null });
  let searchBudget = 3000;
  const deadline = Date.now() + 20000;
  try {
    for (const p of positions.slice(0, 8)) {
      task.check(); checkAir(bot);
      const valid = () => operation === 'place' ? eligible(p) : bot.blockAt(p)?.name === name;
      if (!valid()) continue;
      const destination = new ConstructionGoal(bot, p, operation, { material: name });
      if (!destination.reachable(bot.entity.position, .2)) {
        if (searchBudget <= 0 || Date.now() >= deadline) break;
        const started = Date.now();
        const route = await surveyRoute(bot, task, movement, destination, Math.min(500, searchBudget));
        searchBudget -= Date.now() - started;
        task.check();
        if (route.status !== 'success') continue;
        if (!approach) {
          const block = bot.blockAt(p);
          if (block?.name === name) return block;
          continue;
        }
        try { await navigate(bot, task, destination, { timeoutMs: Math.min(8000, deadline - Date.now()), stallMs: 4000,
          ...(operation === 'place' ? { navigationOnly: true, onFoot: true, passing: false } : {}) }); }
        catch (err) {
          task.check();
          if (['NeedsAir', 'NeedsSafety'].includes(err.name)) throw err;
          continue;
        }
      }
      task.check(); checkAir(bot);
      const block = bot.blockAt(p), fresh = new ConstructionGoal(bot, p, operation, { material: name });
      if (valid() && fresh.reachable(bot.entity.position, .2)) {
        if (!attempt) return block;
        const face = fresh.placement.getFaceAndRef(bot.entity.position.offset(0, 1.62, 0));
        if (face && await attempt(p, face)) return bot.blockAt(p);
      }
    }
    return null;
  } finally {
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete movement[key]; else movement[key] = value;
  }
}

const approachWorkstation = (bot, task, name, positions) => selectWorkstation(bot, task, name, positions, true);
const reachableWorkstation = (bot, task, name, positions) => selectWorkstation(bot, task, name, positions, false);
const placeWorkstation = (bot, task, name, positions, eligible, attempt) => selectWorkstation(bot, task, name, positions, true, { operation: 'place', eligible, attempt });

module.exports = { approachWorkstation, reachableWorkstation, placeWorkstation };
