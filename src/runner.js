'use strict';

const ui = require('./ui');
const sleep = ui.sleep;

/**
 * 跑一“局”（从发牌到分出胜负）
 * @param game     Game 实例
 * @param players  [{name, bot}]
 * @param decider  async (state, seat) => action
 * @param onUpdate (state) => void
 */
async function runDeal(game, players, decider, onUpdate, opts) {
  opts = opts || {};
  const state = game.start(players);

  if (opts.onStart) opts.onStart(state);

  let guard = 0;
  while (!state.over) {
    if (guard++ > 5000) throw new Error('对局异常：回合数过多');
    const seat = game.asker(state);
    if (seat === null || seat === undefined) break;
    if (onUpdate) onUpdate(state);
    let action;
    try {
      action = await decider(state, seat);
    } catch (e) {
      if (opts.onError) opts.onError(String(e && e.message || e), seat);
      break;
    }
    const res = game.apply(state, seat, action);
    if (!res.ok) {
      if (opts.onReject) opts.onReject(res.err, seat, state);
    }
  }
  if (onUpdate) onUpdate(state);
  return state;
}

/** 跑若干局，遇到“流局重发”自动重来 */
async function runRounds(game, players, decider, onUpdate, rounds, opts) {
  const results = [];
  for (let i = 0; i < rounds; i++) {
    let state;
    let tries = 0;
    do {
      state = await runDeal(game, players, decider, onUpdate, opts);
      tries++;
    } while (state.result && state.result.type === 'redeal' && tries < 5);
    results.push(state);
    if (opts && opts.onRoundEnd) opts.onRoundEnd(state, i);
  }
  return results;
}

module.exports = {
  runDeal: runDeal,
  runRounds: runRounds,
  sleep: sleep,
};
