'use strict';

const BaseGame = require('./base');

/** 跑得快 */
class PaoDeKuai extends BaseGame {
  constructor(rules) {
    super(rules);
  }

  setupPhase(state) {
    // 找 ♠3 的持有者先出
    let first = -1;
    for (let i = 0; i < state.seats.length && first < 0; i++) {
      const has = state.seats[i].hand.some(function (c) { return c.r === 3 && c.s === 0; });
      if (has) first = i;
    }
    if (first < 0) {
      // 没发到 ♠3 —— 退化为手持最小牌者先出，且不强制
      state.extra.needSpade3 = false;
      first = 0;
    } else {
      state.extra.needSpade3 = true;
    }
    state.firstSeat = first;
    state.turn = first;
    state.lastSeat = first;
    state.phase = 'play';
  }

  checkOver(state) {
    for (let i = 0; i < state.seats.length; i++) {
      if (state.seats[i].out) return { type: 'win', seat: i };
    }
    return null;
  }

  onGameEnd(state, result) {
    if (result.type !== 'win') return;
    for (let i = 0; i < state.seats.length; i++) {
      // 赢家 0 分，其他人按剩余张数扣分
      state.seats[i].gained = (i === result.seat) ? 0 : -state.seats[i].hand.length;
    }
    result.text = state.seats[result.seat].name + ' 先跑完';
  }
}

module.exports = PaoDeKuai;
