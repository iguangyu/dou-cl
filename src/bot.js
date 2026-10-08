'use strict';

const C = require('./core/cards');
const combo = require('./core/combo');
const rulesMod = require('./core/rules');
const T = combo.T;

/* ------------------------------------------------------------------ */
/* 叫分                                                               */
/* ------------------------------------------------------------------ */

function handStrength(hand) {
  const grp = C.groupByRank(hand);
  let s = 0;
  const cnt = function (r) { return (grp.get(r) || []).length; };

  s += cnt(17) * 6;
  s += cnt(16) * 5;
  s += cnt(15) * 2.5;
  s += cnt(14) * 1;

  let bombs = 0;
  grp.forEach(function (v) {
    if (v.length === 4) bombs++;
    if (v.length === 3) s += 0.5;
  });
  s += bombs * 6;
  if (cnt(16) >= 1 && cnt(17) >= 1) s += 6;

  // 顺子潜力
  let run = 0;
  for (let r = 3; r <= 14; r++) {
    if (grp.has(r)) { run++; s += run >= 5 ? 0.4 : 0; } else run = 0;
  }
  return s;
}

function bidAction(game, state, seat) {
  const hand = state.seats[seat].hand;
  const s = handStrength(hand);
  let want = 0;
  if (s >= 13) want = 3;
  else if (s >= 8.5) want = 2;
  else if (s >= 5) want = 1;
  // 不能低于当前最高叫分
  while (want > 0 && want <= state.extra.highBid) want--;
  return { type: 'bid', score: want };
}

/* ------------------------------------------------------------------ */
/* 评分辅助                                                           */
/* ------------------------------------------------------------------ */

function pointValue(cards, rules) {
  if (!rules.scoreRanks) return 0;
  let v = 0;
  for (let i = 0; i < cards.length; i++) {
    const p = rules.scoreRanks[cards[i].r];
    if (p) v += p;
  }
  return v;
}

function isBomb(comboObj) {
  return comboObj.type === T.BOMB || comboObj.type === T.ROCKET;
}

function isTeammate(state, a, b) {
  if (!state.rules.teams) return false;
  return a !== b && state.seats[a].team === state.seats[b].team;
}

/** 还能一次出完吗 */
function finisher(hand, rules, target) {
  if (!target) {
    const cands = combo.leadCandidates(hand, rules);
    for (let i = 0; i < cands.length; i++) {
      if (cands[i].cards.length === hand.length) return cands[i];
    }
    return null;
  }
  const beats = combo.findBeats(hand, target, rules);
  for (let i = 0; i < beats.length; i++) {
    if (beats[i].cards.length === hand.length) return beats[i];
  }
  return null;
}

/** 有人快跑完了？ */
function danger(state, seat) {
  let d = 0;
  for (let i = 0; i < state.seats.length; i++) {
    if (i === seat || state.seats[i].out) continue;
    if (isTeammate(state, seat, i)) continue;
    if (state.seats[i].hand.length <= 2) d++;
  }
  return d;
}

/* ------------------------------------------------------------------ */
/* 出牌                                                               */
/* ------------------------------------------------------------------ */

function playAction(game, state, seat) {
  const rules = state.rules;
  const hand = state.seats[seat].hand;
  const me = state.seats[seat];

  // 首手必须带 ♠3
  if (rules.firstMoveMustHaveSpade3 && state.extra.needSpade3) {
    const spade3 = hand.find(function (c) { return c.r === 3 && c.s === 0; });
    if (spade3) {
      const cands = combo.leadCandidates(hand, rules).filter(function (cd) {
        return cd.cards.some(function (c) { return c.r === 3 && c.s === 0; });
      });
      if (cands.length) return pickLead(state, seat, cands);
      return { type: 'play', ids: [spade3.id] };
    }
  }

  const target = (state.last && state.last.seat !== seat) ? state.last : null;

  // ---------- 跟牌 ----------
  if (target) {
    const fin = finisher(hand, rules, target);
    if (fin) return { type: 'play', ids: fin.cards.map(function (c) { return c.id; }) };

    // 队友的牌，一般不压
    if (isTeammate(state, seat, target.seat)) {
      return { type: 'pass' };
    }

    const beats = combo.findBeats(hand, target, rules);
    if (!beats.length) return { type: 'pass' };

    const normal = beats.filter(function (b) { return !isBomb(b.combo); });
    const bombs = beats.filter(function (b) { return isBomb(b.combo); });

    if (normal.length) {
      normal.sort(function (a, b) { return costFollow(a, rules) - costFollow(b, rules); });
      const best = normal[0];
      // 手上牌很少时优先出掉大牌压死
      if (me.hand.length <= 5) return { type: 'play', ids: best.cards.map(idOf) };
      return { type: 'play', ids: best.cards.map(idOf) };
    }

    // 只能用炸弹
    const d = danger(state, seat);
    const worth = d > 0 || me.hand.length <= 4 || (state.last.combo && state.last.combo.len >= 4);
    if (worth && bombs.length) {
      bombs.sort(function (a, b) { return costFollow(a, rules) - costFollow(b, rules); });
      return { type: 'play', ids: bombs[0].cards.map(idOf) };
    }
    return { type: 'pass' };
  }

  // ---------- 领出 ----------
  if (hand.length === 1) return { type: 'play', ids: [hand[0].id] };
  const fin = finisher(hand, rules, null);
  if (fin) return { type: 'play', ids: fin.cards.map(idOf) };

  const cands = combo.leadCandidates(hand, rules);
  if (!cands.length) return { type: 'pass' };
  const res = pickLead(state, seat, cands);
  return res;
}

function idOf(c) { return c.id; }

function costFollow(b, rules) {
  const cb = b.combo;
  let c = cb.main * 2 - b.cards.length * 2;
  if (isBomb(cb)) c += 500;
  c += pointValue(b.cards, rules) * 0.6; // 尽量别用分牌去压
  return c;
}

function costLead(b, rules, state) {
  const cb = b.combo;
  let c = cb.main * 2.2 - b.cards.length * 4;
  if (isBomb(cb)) c += 400;
  if (cb.type === T.SINGLE) c += 14;
  if (cb.type === T.PAIR) c += 6;
  if (cb.type === T.TRIO) c += 4;
  if (cb.type === T.FLUSH) c -= 3;       // 同花顺能压同长度顺子，同价时优先出它
  if (cb.type === T.FIFTYK) c -= 2;      // 五十K 同理
  c += pointValue(b.cards, rules) * 0.8; // 领出时也别乱甩分牌
  return c;
}

function pickLead(state, seat, cands) {
  const rules = state.rules;
  const scored = cands.map(function (b) {
    return { b: b, c: costLead(b, rules, state) };
  }).sort(function (a, b) { return a.c - b.c; });

  // 下家只剩 1 张 → 甩大单张压制
  const me = state.seats[seat];
  const n = state.seats.length;
  for (let k = 1; k < n; k++) {
    const nx = (seat + k) % n;
    if (state.seats[nx].out) continue;
    if (isTeammate(state, seat, nx)) break;
    if (state.seats[nx].hand.length === 1) {
      const singles = cands.filter(function (b) { return b.combo.type === T.SINGLE; });
      if (singles.length) {
        singles.sort(function (a, b) { return b.combo.main - a.combo.main; });
        const big = singles[0];
        if (big.combo.main >= 14) return { type: 'play', ids: big.cards.map(idOf) };
      }
    }
    break;
  }

  const best = scored[0].b;
  return { type: 'play', ids: best.cards.map(idOf) };
}

/* ------------------------------------------------------------------ */

function chooseAction(game, state, seat) {
  if (state.phase === 'bid') return bidAction(game, state, seat);
  return playAction(game, state, seat);
}

/**
 * 只有“视野”（联网客户端）时算一个提示
 * view 为 engine.view() 的结果
 */
function hintFromView(view, seat) {
  const rules = rulesMod.get(view.key);
  const seats = view.seats.map(function (s, i) {
    return {
      hand: i === seat ? (view.hand || []).slice() : new Array(s.count),
      team: s.team,
      out: s.out,
    };
  });
  const state = {
    rules: rules,
    seats: seats,
    phase: 'play',
    turn: seat,
    last: (view.last && combo.analyze(view.last.cards, rules))
      ? { seat: view.last.seat, cards: view.last.cards, combo: combo.analyze(view.last.cards, rules) }
      : null,
    lastSeat: view.lastSeat,
    extra: { needSpade3: !!(view.extra && view.extra.needSpade3) },
  };
  try {
    return playAction(null, state, seat);
  } catch (e) {
    return { type: 'pass' };
  }
}

module.exports = {
  chooseAction: chooseAction,
  bidAction: bidAction,
  playAction: playAction,
  handStrength: handStrength,
  hintFromView: hintFromView,
};
