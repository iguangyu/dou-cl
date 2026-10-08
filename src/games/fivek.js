'use strict';

const BaseGame = require('./base');

/** 510K（两副牌 · 4 人 · 5/10/K 计分） */
class FiveTenK extends BaseGame {
  constructor(rules) {
    super(rules);
  }

  setupPhase(state) {
    state.firstSeat = Math.floor(Math.random() * state.seats.length);
    state.turn = state.firstSeat;
    state.lastSeat = state.firstSeat;
    state.extra.trickCards = [];
    state.extra.trickNo = 0;
    state.extra.scoreRanks = state.rules.scoreRanks;
    state.extra.lastCaptured = null;
    state.phase = 'play';
  }

  /** 记牌：本轮出现的牌 */
  afterPlay(state, seat, co) {
    const tc = state.extra.trickCards;
    const idSet = new Set(tc.map(function (c) { return c.id; }));
    const latest = state.last ? state.last.cards : [];
    for (let i = 0; i < latest.length; i++) {
      if (!idSet.has(latest[i].id)) tc.push(latest[i]);
    }
  }

  /** 一轮结束：桌面分牌归最后出牌的人 */
  onTrickEnd(state, leader, allPassed) {
    this.settleTrick(state, leader);
  }

  settleTrick(state, leader) {
    if (leader < 0) return;
    const tc = state.extra.trickCards || [];
    if (!tc.length) return;
    const ranks = state.rules.scoreRanks;
    let pts = 0;
    for (let i = 0; i < tc.length; i++) {
      const v = ranks[tc[i].r];
      if (v) pts += v;
    }
    state.extra.trickNo++;
    if (pts > 0) {
      state.seats[leader].gained += pts;
      state.history.push({ seat: leader, kind: 'score', points: pts });
    }
    state.extra.lastCaptured = { seat: leader, points: pts, count: tc.length };
    state.extra.trickCards = [];
  }

  checkOver(state) {
    for (let i = 0; i < state.seats.length; i++) {
      if (state.seats[i].out) return { type: 'win', seat: i };
    }
    return null;
  }

  onGameEnd(state, result) {
    if (result.type !== 'win') return;
    // 结算尚未收尾的这一轮
    this.settleTrick(state, state.lastSeat);
    result.text = state.seats[result.seat].name + ' 先出完';
    let best = -1, bestPts = -1;
    for (let i = 0; i < state.seats.length; i++) {
      if (state.seats[i].gained > bestPts) { bestPts = state.seats[i].gained; best = i; }
    }
    result.scoreKing = best;
    result.scoreKingPoints = bestPts;
  }
}

module.exports = FiveTenK;
