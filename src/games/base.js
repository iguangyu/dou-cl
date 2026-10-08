'use strict';

const C = require('../core/cards');
const combo = require('../core/combo');

/**
 * 通用回合引擎（出牌阶段）
 * 子类负责：发牌 / 叫分 / 胜负判定 / 计分
 */
class BaseGame {
  constructor(rules) {
    this.rules = rules;
    this.key = rules.key;
    this.name = rules.name;
  }

  /* ---------------- 供子类覆盖 ---------------- */

  /** 发牌后、出牌前的初始化（叫分等） */
  setupPhase(state) {
    state.phase = 'play';
    state.turn = state.firstSeat || 0;
    state.lastSeat = state.turn;
  }

  /** 当前该谁做决定 */
  asker(state) {
    if (state.phase === 'over') return null;
    return state.turn;
  }

  /** 出牌后回调 */
  afterPlay(state, seat, comboObj) {}

  /** 一轮结束回调 */
  onTrickEnd(state, leader, allPassed) {}

  /** 是否结束，返回 result 或 null */
  checkOver(state) { return null; }

  /** 结束时结算 */
  onGameEnd(state, result) {}

  /** 轮到 seat 时能否过牌 */
  canPass(state, seat) {
    return !!(state.last && state.last.seat !== seat);
  }

  /* ---------------- 开局 ---------------- */

  start(players) {
    const rules = this.rules;
    const n = rules.seats;
    const deck = C.shuffle(C.createDeck(rules.deck));
    const seats = [];
    for (let i = 0; i < n; i++) {
      seats.push({
        name: players[i] ? players[i].name : ('玩家' + (i + 1)),
        bot: players[i] ? !!players[i].bot : true,
        hand: [],
        out: false,
        role: '',
        team: i,
        gained: 0,
      });
    }
    let p = 0;
    for (let i = 0; i < n * rules.handSize; i++) {
      seats[p % n].hand.push(deck[i]);
      p++;
    }
    const bottom = deck.slice(n * rules.handSize);

    const state = {
      key: this.key,
      rules: rules,
      seats: seats,
      bottom: bottom,
      bottomRevealed: false,
      phase: 'play',
      turn: 0,
      firstSeat: 0,
      last: null,
      lastSeat: -1,
      passCount: 0,
      history: [],
      over: false,
      result: null,
      extra: { multiplier: 1 },
    };

    seats.forEach(function (s) { s.hand = C.sortHand(s.hand); });
    this.setupPhase(state);
    if (state.lastSeat === -1) state.lastSeat = state.turn;
    return state;
  }

  /* ---------------- 校验 ---------------- */

  /**
   * 校验动作，不改变状态
   * @returns {{ok:boolean, err?:string, cards?:Array, combo?:Object}}
   */
  validate(state, seat, action) {
    if (state.over) return { ok: false, err: '本局已结束' };
    if (state.phase === 'bid') return this.validateBid(state, seat, action);
    if (state.phase !== 'play') return { ok: false, err: '当前不能操作' };
    if (state.turn !== seat) return { ok: false, err: '还没轮到你' };
    if (!action) return { ok: false, err: '空动作' };

    if (action.type === 'pass') {
      if (!this.canPass(state, seat)) return { ok: false, err: '你是先手，必须出牌' };
      return { ok: true };
    }
    if (action.type === 'play') {
      return this.validatePlay(state, seat, action.ids);
    }
    return { ok: false, err: '未知动作' };
  }

  validatePlay(state, seat, ids) {
    const me = state.seats[seat];
    const rules = this.rules;
    if (!ids || !ids.length) return { ok: false, err: '没有选择任何牌' };
    const idSet = new Set(ids);
    if (idSet.size !== ids.length) return { ok: false, err: '同一张牌选了两次' };
    const picked = [];
    for (const id of ids) {
      const c = me.hand.find(function (x) { return x.id === id; });
      if (!c) return { ok: false, err: '手牌里没有这张牌' };
      picked.push(c);
    }
    const co = combo.analyze(picked, rules);
    if (!co) return { ok: false, err: '不是合法牌型' };

    if (rules.firstMoveMustHaveSpade3 && state.extra.needSpade3) {
      const ok = picked.some(function (c) { return c.r === 3 && c.s === 0; });
      if (!ok) return { ok: false, err: '首手必须带上 ♠3' };
    }
    if (state.last && state.last.seat !== seat) {
      if (!combo.canBeat(co, state.last.combo, rules)) {
        return {
          ok: false,
          err: '管不上上家的牌（' + combo.typeName(state.last.combo.type) + '，' +
            state.last.cards.length + ' 张）',
        };
      }
    }
    return { ok: true, cards: picked, combo: co };
  }

  validateBid(state, seat, action) {
    return { ok: false, err: '本玩法没有叫分阶段' };
  }

  /* ---------------- 执行 ---------------- */

  apply(state, seat, action) {
    const v = this.validate(state, seat, action);
    if (!v.ok) return v;

    if (state.phase === 'bid') return this.doBid(state, seat, action);

    if (action.type === 'pass') return this.doPass(state, seat);
    return this.doPlay(state, seat, v.cards, v.combo);
  }

  doBid(state, seat, action) {
    return { ok: false, err: 'not implemented' };
  }

  doPass(state, seat) {
    const n = state.seats.length;
    state.passCount++;
    this.log(state, seat, 'pass');
    if (state.passCount >= n - 1) {
      const leader = state.lastSeat;
      state.last = null;
      state.passCount = 0;
      state.turn = leader;
      this.onTrickEnd(state, leader, true);
    } else {
      state.turn = (seat + 1) % n;
      let guard = 0;
      while (state.seats[state.turn].out && guard++ < n) state.turn = (state.turn + 1) % n;
    }
    return { ok: true };
  }

  doPlay(state, seat, picked, co) {
    const me = state.seats[seat];
    const idSet = new Set(picked.map(function (c) { return c.id; }));

    me.hand = me.hand.filter(function (c) { return !idSet.has(c.id); });
    state.last = { seat: seat, cards: picked, combo: co };
    state.lastSeat = seat;
    state.passCount = 0;
    state.extra.needSpade3 = false;
    this.log(state, seat, 'play', picked, co);
    this.afterPlay(state, seat, co);

    if (me.hand.length === 0) {
      me.out = true;
      state.extra.finishOrder = state.extra.finishOrder || [];
      state.extra.finishOrder.push(seat);
    }

    const res = this.checkOver(state);
    if (res) {
      state.over = true;
      state.phase = 'over';
      state.result = res;
      this.onGameEnd(state, res);
      return { ok: true };
    }

    const n = state.seats.length;
    let next = (seat + 1) % n;
    let guard = 0;
    while (state.seats[next].out && guard++ < n) next = (next + 1) % n;
    state.turn = next;
    return { ok: true };
  }

  /* ---------------- 工具 ---------------- */

  log(state, seat, kind, cards, co) {
    state.history.push({
      seat: seat,
      kind: kind,
      cards: cards || null,
      type: co ? co.type : null,
    });
    if (state.history.length > 300) state.history.shift();
  }

  view(state, seat) {
    return {
      key: state.key,
      name: this.name,
      phase: state.phase,
      turn: state.turn,
      bottom: state.bottomRevealed ? state.bottom : null,
      bottomCount: state.bottom.length,
      lastSeat: state.lastSeat,
      last: state.last ? {
        seat: state.last.seat,
        cards: state.last.cards,
        type: state.last.combo.type,
      } : null,
      passCount: state.passCount,
      over: state.over,
      result: state.result,
      extra: {
        multiplier: state.extra.multiplier || 1,
        baseScore: state.extra.baseScore || 0,
        landlord: state.extra.landlord,
        needSpade3: !!state.extra.needSpade3,
      },
      history: state.history.slice(-12),
      hand: (seat >= 0 && state.seats[seat]) ? C.sortHand(state.seats[seat].hand) : [],
      canPass: seat >= 0 ? this.canPass(state, seat) : false,
      seats: state.seats.map(function (s, i) {
        return {
          i: i,
          name: s.name,
          bot: s.bot,
          count: s.hand.length,
          out: s.out,
          role: s.role,
          team: s.team,
          score: s.gained,
          isYou: i === seat,
        };
      }),
    };
  }
}

module.exports = BaseGame;
