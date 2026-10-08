'use strict';

const BaseGame = require('./base');
const C = require('../core/cards');
const combo = require('../core/combo');
const T = combo.T;

/** 斗地主 */
class DouDizhu extends BaseGame {
  constructor(rules) {
    super(rules);
  }

  setupPhase(state) {
    state.phase = 'bid';
    state.extra.bids = [];
    state.extra.highBid = 0;
    state.extra.highSeat = -1;
    state.extra.bidCount = 0;
    state.extra.multiplier = 1;
    state.extra.baseScore = 0;
    state.extra.landlord = -1;
    state.extra.redeal = false;
    // 随机决定谁先叫分
    state.firstSeat = Math.floor(Math.random() * state.seats.length);
    state.turn = state.firstSeat;
    state.lastSeat = state.firstSeat;
  }

  asker(state) {
    return state.turn;
  }

  validateBid(state, seat, action) {
    if (state.over) return { ok: false, err: '本局已结束' };
    if (state.turn !== seat) return { ok: false, err: '还没轮到你叫分' };
    if (!action || action.type !== 'bid') return { ok: false, err: '当前是叫分阶段' };
    const score = action.score | 0;
    if (score < 0 || score > 3) return { ok: false, err: '叫分只能是 0/1/2/3' };
    if (score > 0 && score <= state.extra.highBid) {
      return { ok: false, err: '必须叫得比 ' + state.extra.highBid + ' 分更高（或叫 0 不叫）' };
    }
    return { ok: true, score: score };
  }

  doBid(state, seat, action) {
    const score = action.score | 0;
    state.extra.bids.push({ seat: seat, score: score });
    if (score > state.extra.highBid) {
      state.extra.highBid = score;
      state.extra.highSeat = seat;
    }
    state.history.push({ seat: seat, kind: 'bid', score: score });

    if (score === 3) {
      this.becomeLandlord(state, seat, 3);
      return { ok: true };
    }
    state.extra.bidCount++;
    if (state.extra.bidCount >= state.seats.length) {
      if (state.extra.highBid === 0) {
        state.over = true;
        state.phase = 'over';
        state.result = { type: 'redeal', text: '三家都不叫，重新发牌' };
        return { ok: true };
      }
      this.becomeLandlord(state, state.extra.highSeat, state.extra.highBid);
      return { ok: true };
    }
    state.turn = (seat + 1) % state.seats.length;
    return { ok: true };
  }

  becomeLandlord(state, seat, base) {
    state.extra.landlord = seat;
    state.extra.baseScore = base;
    state.seats[seat].role = '地主';
    state.seats[seat].team = 0;
    for (let i = 0; i < state.seats.length; i++) {
      if (i !== seat) { state.seats[i].role = '农民'; state.seats[i].team = 1; }
    }
    state.seats[seat].hand = C.sortHand(state.seats[seat].hand.concat(state.bottom));
    state.bottomRevealed = true;
    state.phase = 'play';
    state.turn = seat;
    state.last = null;
    state.lastSeat = seat;
    state.passCount = 0;
    state.history.push({ seat: seat, kind: 'landlord' });
  }

  afterPlay(state, seat, co) {
    if (co.type === T.BOMB || co.type === T.ROCKET) {
      state.extra.multiplier *= 2;
      state.history.push({ seat: seat, kind: 'bomb', type: co.type });
    }
  }

  checkOver(state) {
    const landlord = state.extra.landlord;
    if (landlord < 0) return null;
    if (state.seats[landlord].out) return { type: 'win', winner: 'landlord', seat: landlord };
    for (let i = 0; i < state.seats.length; i++) {
      if (i !== landlord && state.seats[i].out) {
        return { type: 'win', winner: 'farmer', seat: i };
      }
    }
    return null;
  }

  onGameEnd(state, result) {
    if (result.type !== 'win') return;
    const landlord = state.extra.landlord;
    const plays = {};
    state.history.forEach(function (h) {
      if (h.kind === 'play') plays[h.seat] = (plays[h.seat] || 0) + 1;
    });
    let mult = state.extra.multiplier;
    let springText = '';
    if (result.winner === 'landlord') {
      let farmerPlayed = false;
      for (let i = 0; i < state.seats.length; i++) {
        if (i !== landlord && plays[i]) farmerPlayed = true;
      }
      if (!farmerPlayed) { mult *= 2; springText = '（春天 x2）'; }
    } else {
      if ((plays[landlord] || 0) <= 1) { mult *= 2; springText = '（反春 x2）'; }
    }
    state.extra.multiplier = mult;
    const unit = state.extra.baseScore * mult;
    for (let i = 0; i < state.seats.length; i++) {
      if (i === landlord) {
        state.seats[i].gained = (result.winner === 'landlord') ? unit * 2 : -unit * 2;
      } else {
        state.seats[i].gained = (result.winner === 'landlord') ? -unit : unit;
      }
    }
    result.text = (result.winner === 'landlord' ? '地主胜利' : '农民胜利') + springText +
      '  底分 ' + state.extra.baseScore + ' x 倍数 ' + mult;
    result.multiplier = mult;
    result.baseScore = state.extra.baseScore;
    result.unit = unit;
  }
}

module.exports = DouDizhu;
