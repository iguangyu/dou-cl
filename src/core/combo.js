'use strict';

/**
 * 牌型识别 / 比大小 / 候选出牌生成
 * 三种玩法共用，通过 rules 开关控制差异。
 */

const cardsMod = require('./cards');
const groupByRank = cardsMod.groupByRank;
const SUIT_POWER = cardsMod.SUIT_POWER;

const T = {
  SINGLE: 'single',
  PAIR: 'pair',
  TRIO: 'trio',
  TRIO1: 'trio1',
  TRIO2: 'trio2',
  STRAIGHT: 'straight',
  STRAIGHTPAIR: 'straightpair',
  PLANE: 'plane',
  PLANE1: 'plane1',
  PLANE2: 'plane2',
  FOUR2: 'four2',
  FOUR2PAIR: 'four2pair',
  BOMB: 'bomb',
  ROCKET: 'rocket',
  FLUSH: 'flush',
  FIFTYK: 'fiftyk',
};

const TYPE_NAME = {
  single: '单张', pair: '对子', trio: '三张', trio1: '三带一', trio2: '三带二',
  straight: '顺子', straightpair: '连对', plane: '飞机', plane1: '飞机带单',
  plane2: '飞机带对', four2: '四带二', four2pair: '四带两对',
  bomb: '炸弹', rocket: '王炸', flush: '同花顺', fiftyk: '五十K',
};

// 顺子类可用的点数范围：3..A（不含 2 和王）
const SEQ_MIN = 3;
const SEQ_MAX = 14;

function typeName(t) {
  return TYPE_NAME[t] || t;
}

/* ------------------------------------------------------------------ */
/* 识别                                                               */
/* ------------------------------------------------------------------ */

function isSeqAll(ranks) {
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] < SEQ_MIN || ranks[i] > SEQ_MAX) return false;
  }
  return true;
}

function consecutive(ranks) {
  for (let i = 1; i < ranks.length; i++) {
    if (ranks[i] !== ranks[i - 1] + 1) return false;
  }
  return true;
}

/** 找出“连续且每点至少 need 张”的长度为 length 的段，返回 rank[] 数组 */
function findRuns(grp, need, length) {
  const rs = [];
  grp.forEach(function (v, r) {
    if (r >= SEQ_MIN && r <= SEQ_MAX && v.length >= need) rs.push(r);
  });
  rs.sort(function (a, b) { return a - b; });
  const out = [];
  for (let i = 0; i + length <= rs.length; i++) {
    if (rs[i + length - 1] === rs[i] + length - 1) out.push(rs.slice(i, i + length));
  }
  return out;
}

/**
 * 识别一手牌的牌型
 * @returns {null|{type,len,main,cards,suit}}
 */
function analyze(cards, rules) {
  const n = cards.length;
  if (n === 0) return null;

  const grp = groupByRank(cards);
  const ranks = [];
  grp.forEach(function (v, r) { ranks.push(r); });
  ranks.sort(function (a, b) { return a - b; });
  const counts = ranks.map(function (r) { return grp.get(r).length; });
  const allSameRank = ranks.length === 1;

  // ---- 五十K（510K 专属）：同花色的 5 / 10 / K 各一张 ----
  if (rules.fiftyK && n === 3 && ranks.length === 3 &&
      ranks[0] === 5 && ranks[1] === 10 && ranks[2] === 13) {
    const s = cards[0].s;
    let same = true;
    for (let i = 1; i < cards.length; i++) if (cards[i].s !== s) { same = false; break; }
    if (same) {
      return { type: T.FIFTYK, len: 3, main: SUIT_POWER[s] || 0, cards: cards, suit: s };
    }
  }

  // ---- 王炸 ----
  if (rules.rocket && allSameRank === false) {
    let onlyJoker = true;
    let hasSmall = false, hasBig = false;
    for (let i = 0; i < cards.length; i++) {
      if (cards[i].r < 16) { onlyJoker = false; break; }
      if (cards[i].r === 16) hasSmall = true;
      if (cards[i].r === 17) hasBig = true;
    }
    if (onlyJoker && hasSmall && hasBig && n >= 2) {
      return { type: T.ROCKET, len: n, main: n, cards: cards };
    }
  }

  // ---- 炸弹（4 张及以上同点）----
  if (allSameRank && n >= 4) {
    return { type: T.BOMB, len: n, main: ranks[0], cards: cards };
  }

  if (n === 1) return { type: T.SINGLE, len: 1, main: ranks[0], cards: cards };

  if (n === 2 && allSameRank) return { type: T.PAIR, len: 2, main: ranks[0], cards: cards };

  if (n === 3 && allSameRank) return { type: T.TRIO, len: 3, main: ranks[0], cards: cards };

  // ---- 三带一 ----
  if (n === 4) {
    for (let i = 0; i < ranks.length; i++) {
      if (counts[i] === 3) return { type: T.TRIO1, len: 4, main: ranks[i], cards: cards };
    }
  }

  // ---- 三带二 ----
  if (n === 5 && ranks.length === 2) {
    for (let i = 0; i < ranks.length; i++) {
      if (counts[i] === 3) return { type: T.TRIO2, len: 5, main: ranks[i], cards: cards };
    }
  }

  // ---- 顺子 / 同花顺 ----
  if (n >= rules.minStraight && ranks.length === n && isSeqAll(ranks) && consecutive(ranks)) {
    let flush = true;
    for (let i = 1; i < cards.length; i++) if (cards[i].s !== cards[0].s) { flush = false; break; }
    if (flush && rules.flushStraight) {
      return { type: T.FLUSH, len: n, main: ranks[ranks.length - 1], cards: cards, suit: cards[0].s };
    }
    return { type: T.STRAIGHT, len: n, main: ranks[ranks.length - 1], cards: cards };
  }

  // ---- 连对 ----
  if (n >= rules.minStraightPair * 2 && n % 2 === 0) {
    let ok = true;
    for (let i = 0; i < counts.length; i++) if (counts[i] !== 2) { ok = false; break; }
    if (ok && isSeqAll(ranks) && consecutive(ranks) && ranks.length >= rules.minStraightPair) {
      return { type: T.STRAIGHTPAIR, len: n, main: ranks[ranks.length - 1], cards: cards };
    }
  }

  // ---- 飞机（纯三顺）----
  if (n >= 6 && n % 3 === 0) {
    let ok = true;
    for (let i = 0; i < counts.length; i++) if (counts[i] !== 3) { ok = false; break; }
    if (ok && isSeqAll(ranks) && consecutive(ranks) && ranks.length >= 2) {
      return { type: T.PLANE, len: n, main: ranks[ranks.length - 1], cards: cards };
    }
  }

  // ---- 四带二 / 四带两对 ----
  if (n === 6) {
    for (let i = 0; i < ranks.length; i++) {
      if (counts[i] === 4) return { type: T.FOUR2, len: 6, main: ranks[i], cards: cards };
    }
  }
  if (n === 8) {
    let hasFour = -1;
    let pairs = 0, singles = 0;
    for (let i = 0; i < ranks.length; i++) {
      if (counts[i] === 4) hasFour = ranks[i];
      else if (counts[i] === 2) pairs++;
      else singles += counts[i];
    }
    if (hasFour >= 0 && pairs === 2) {
      return { type: T.FOUR2PAIR, len: 8, main: hasFour, cards: cards };
    }
  }

  // ---- 飞机带翅膀 ----
  const planeRes = analyzePlane(cards, grp, rules);
  if (planeRes) return planeRes;

  return null;
}

/** 飞机带单 / 飞机带对（暴力枚举连续三张段） */
function analyzePlane(cards, grp, rules) {
  const n = cards.length;
  if (n < 8) return null; // 最小 2 连三张 + 2 翅膀 = 8

  const triRanks = [];
  grp.forEach(function (v, r) {
    if (v.length >= 3 && r >= SEQ_MIN && r <= SEQ_MAX) triRanks.push(r);
  });
  triRanks.sort(function (a, b) { return a - b; });

  // 枚举所有连续段（长度 >= 2）
  for (let i = 0; i < triRanks.length; i++) {
    for (let k = 2; i + k <= triRanks.length; k++) {
      if (triRanks[i + k - 1] !== triRanks[i] + k - 1) break;

      // 取这 k 个点各 3 张
      const used = [];
      for (let j = 0; j < k; j++) {
        const arr = grp.get(triRanks[i + j]);
        used.push(arr[0], arr[1], arr[2]);
      }
      const usedIds = new Set(used.map(function (c) { return c.id; }));
      const rest = cards.filter(function (c) { return !usedIds.has(c.id); });
      const main = triRanks[i + k - 1];

      // 飞机带单：剩下 k 张
      if (rest.length === k && n === 4 * k) {
        return { type: T.PLANE1, len: n, main: main, cards: cards };
      }
      // 飞机带对：剩下 k 对
      if (rest.length === 2 * k && n === 5 * k) {
        const rg = groupByRank(rest);
        let ok = true;
        rg.forEach(function (v) { if (v.length !== 2) ok = false; });
        if (ok && rg.size === k) {
          return { type: T.PLANE2, len: n, main: main, cards: cards };
        }
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 比大小                                                             */
/* ------------------------------------------------------------------ */

function isBombType(t) { return t === T.BOMB || t === T.ROCKET; }

/**
 * a 能否压过 b
 */
function canBeat(a, b, rules) {
  if (!a) return false;
  if (!b) return true;

  if (a.type === T.ROCKET) {
    if (b.type === T.ROCKET) return a.len > b.len;
    return true;
  }
  if (b.type === T.ROCKET) return false;

  if (a.type === T.BOMB) {
    if (b.type === T.BOMB) {
      if (a.len !== b.len) return a.len > b.len;
      return a.main > b.main;
    }
    return true;
  }
  if (b.type === T.BOMB) return false;

  if (a.type === T.FIFTYK) {
    if (b.type === T.FIFTYK) return a.main >= b.main;
    return true;
  }
  if (b.type === T.FIFTYK) return false;

  // 同花顺可以压同长度的普通顺子
  if (a.type === T.FLUSH && b.type === T.STRAIGHT && a.len === b.len) return a.main > b.main;

  return a.type === b.type && a.len === b.len && a.main > b.main;
}

/* ------------------------------------------------------------------ */
/* 候选生成                                                           */
/* ------------------------------------------------------------------ */

function takeCards(arr, k) {
  return arr.slice(0, k);
}

/**
 * 生成指定牌型的候选出牌
 * @param hand   手牌
 * @param type   目标牌型
 * @param len    目标张数
 * @param rules  规则
 * @param minMain 要求 main > minMain
 */
function genCombos(hand, type, len, rules, minMain) {
  if (minMain === undefined || minMain === null) minMain = -1;
  const grp = groupByRank(hand);
  const ranks = [];
  grp.forEach(function (v, r) { ranks.push(r); });
  ranks.sort(function (a, b) { return a - b; });

  const out = [];
  const has = function (r, k) { return grp.has(r) && grp.get(r).length >= k; };
  const take = function (r, k) { return takeCards(grp.get(r), k); };

  switch (type) {
    case T.SINGLE:
      ranks.forEach(function (r) { if (r > minMain) out.push(take(r, 1)); });
      break;

    case T.PAIR:
      ranks.forEach(function (r) { if (has(r, 2) && r > minMain) out.push(take(r, 2)); });
      break;

    case T.TRIO:
      ranks.forEach(function (r) { if (has(r, 3) && r > minMain) out.push(take(r, 3)); });
      break;

    case T.STRAIGHT:
      findRuns(grp, 1, len).forEach(function (run) {
        if (run[run.length - 1] > minMain) {
          const cs = [];
          run.forEach(function (r) { cs.push(grp.get(r)[0]); });
          out.push(cs);
        }
      });
      break;

    case T.FLUSH:
      findRuns(grp, 1, len).forEach(function (run) {
        if (run[run.length - 1] <= minMain) return;
        // 每个花色尝试一次
        for (let s = 0; s < 4; s++) {
          const cs = [];
          let ok = true;
          for (let i = 0; i < run.length; i++) {
            const arr = grp.get(run[i]);
            const found = arr.filter(function (c) { return c.s === s; })[0];
            if (!found) { ok = false; break; }
            cs.push(found);
          }
          if (ok) out.push(cs);
        }
      });
      break;

    case T.STRAIGHTPAIR:
      findRuns(grp, 2, len / 2).forEach(function (run) {
        if (run[run.length - 1] > minMain) {
          const cs = [];
          run.forEach(function (r) { cs.push(grp.get(r)[0], grp.get(r)[1]); });
          out.push(cs);
        }
      });
      break;

    case T.PLANE:
      findRuns(grp, 3, len / 3).forEach(function (run) {
        if (run[run.length - 1] > minMain) {
          const cs = [];
          run.forEach(function (r) { cs.push(grp.get(r)[0], grp.get(r)[1], grp.get(r)[2]); });
          out.push(cs);
        }
      });
      break;

    case T.TRIO1:
    case T.TRIO2:
    case T.PLANE1:
    case T.PLANE2: {
      let trioLen, wingKind; // wingKind: 1=单 2=对
      if (type === T.TRIO1) { trioLen = 1; wingKind = 1; }
      else if (type === T.TRIO2) { trioLen = 1; wingKind = 2; }
      else if (type === T.PLANE1) { trioLen = len / 4; wingKind = 1; }
      else { trioLen = len / 5; wingKind = 2; }

      const runs = findRuns(grp, 3, trioLen);
      runs.forEach(function (run) {
        if (run[run.length - 1] <= minMain) return;
        const body = [];
        run.forEach(function (r) { body.push(grp.get(r)[0], grp.get(r)[1], grp.get(r)[2]); });
        const usedRanks = new Set(run);
        const wings = pickWings(grp, ranks, usedRanks, trioLen, wingKind);
        if (wings) out.push(body.concat(wings));
      });
      break;
    }

    case T.FOUR2:
    case T.FOUR2PAIR: {
      const need = type === T.FOUR2 ? 1 : 2; // 需要几“组”翅膀
      const wKind = type === T.FOUR2 ? 1 : 2;
      ranks.forEach(function (r) {
        if (!has(r, 4) || r <= minMain) return;
        const body = take(r, 4);
        const used = new Set([r]);
        const wings = pickWings(grp, ranks, used, need, wKind);
        if (wings) out.push(body.concat(wings));
      });
      break;
    }

    case T.BOMB:
      ranks.forEach(function (r) {
        if (!has(r, 4)) return;
        if (len && len !== 4) return;
        if (r > minMain) out.push(take(r, 4));
      });
      break;

    case T.ROCKET: {
      const small = grp.get(16) || [];
      const big = grp.get(17) || [];
      if (small.length && big.length) out.push([small[0], big[0]]);
      break;
    }

    case T.FIFTYK: {
      for (let s = 0; s < 4; s++) {
        const a = (grp.get(5) || []).filter(function (c) { return c.s === s; })[0];
        const b = (grp.get(10) || []).filter(function (c) { return c.s === s; })[0];
        const c2 = (grp.get(13) || []).filter(function (c) { return c.s === s; })[0];
        if (a && b && c2) {
          if (SUIT_POWER[s] >= minMain) out.push([a, b, c2]);
        }
      }
      break;
    }
  }
  return out;
}

/**
 * 挑选翅膀：优先用“散张/小牌”，避免拆散炸弹和顺子
 */
function pickWings(grp, ranks, usedRanks, count, kind) {
  const cand = ranks.filter(function (r) {
    if (usedRanks.has(r)) return false;
    return grp.get(r).length >= kind;
  });
  // 排序：张数少优先、点数小优先、非炸弹优先
  cand.sort(function (a, b) {
    const ca = grp.get(a).length, cb = grp.get(b).length;
    const sa = (ca === 4 ? 100 : 0) + ca * 10 + a;
    const sb = (cb === 4 ? 100 : 0) + cb * 10 + b;
    return sa - sb;
  });
  if (cand.length < count) return null;
  const chosen = cand.slice(0, count);
  const out = [];
  chosen.forEach(function (r) { out.push.apply(out, takeCards(grp.get(r), kind)); });
  return out;
}

/**
 * 找出所有能压过 target 的出牌（含炸弹/王炸/五十K）
 */
function findBeats(hand, target, rules) {
  const res = [];
  if (!target) return res;
  const tt = target.combo ? target.combo : target;

  // 同类型
  const same = genCombos(hand, tt.type, tt.len, rules, tt.main);
  same.forEach(function (cs) {
    const a = analyze(cs, rules);
    if (a && canBeat(a, tt, rules)) res.push({ cards: cs, combo: a });
  });

  // 同花顺可以压同长度的普通顺子
  if (rules.flushStraight && tt.type === T.STRAIGHT) {
    genCombos(hand, T.FLUSH, tt.len, rules, tt.main).forEach(function (cs) {
      const a = analyze(cs, rules);
      if (a && canBeat(a, tt, rules)) res.push({ cards: cs, combo: a });
    });
  }

  // 炸弹
  if (tt.type !== T.BOMB && tt.type !== T.ROCKET) {
    genCombos(hand, T.BOMB, 4, rules, -1).forEach(function (cs) {
      const a = analyze(cs, rules);
      if (a && canBeat(a, tt, rules)) res.push({ cards: cs, combo: a });
    });
  } else if (tt.type === T.BOMB) {
    genCombos(hand, T.BOMB, 4, rules, tt.main).forEach(function (cs) {
      const a = analyze(cs, rules);
      if (a && canBeat(a, tt, rules)) res.push({ cards: cs, combo: a });
    });
  }

  // 王炸
  if (rules.rocket && tt.type !== T.ROCKET) {
    genCombos(hand, T.ROCKET, 2, rules, -1).forEach(function (cs) {
      const a = analyze(cs, rules);
      if (a && canBeat(a, tt, rules)) res.push({ cards: cs, combo: a });
    });
  }

  // 五十K
  if (rules.fiftyK && tt.type !== T.FIFTYK && tt.type !== T.BOMB && tt.type !== T.ROCKET) {
    genCombos(hand, T.FIFTYK, 3, rules, -1).forEach(function (cs) {
      const a = analyze(cs, rules);
      if (a && canBeat(a, tt, rules)) res.push({ cards: cs, combo: a });
    });
  }

  return dedupe(res);
}

function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const key = list[i].cards.map(function (c) { return c.id; }).sort(function (a, b) { return a - b; }).join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(list[i]);
  }
  return out;
}

/**
 * 生成“领出”时的候选（用于 AI 与提示）
 */
function leadCandidates(hand, rules) {
  const res = [];
  const push = function (cs) {
    const a = analyze(cs, rules);
    if (a) res.push({ cards: cs, combo: a });
  };

  [T.SINGLE, T.PAIR, T.TRIO].forEach(function (t) {
    genCombos(hand, t, 0, rules, -1).forEach(push);
  });
  genCombos(hand, T.TRIO1, 4, rules, -1).forEach(push);
  genCombos(hand, T.TRIO2, 5, rules, -1).forEach(push);

  const grp = groupByRank(hand);
  let maxRun = 0;
  grp.forEach(function () { maxRun++; });
  for (let L = rules.minStraight; L <= 12; L++) genCombos(hand, T.STRAIGHT, L, rules, -1).forEach(push);
  for (let L = rules.minStraightPair; L <= 10; L++) genCombos(hand, T.STRAIGHTPAIR, L * 2, rules, -1).forEach(push);
  for (let L = 2; L <= 6; L++) genCombos(hand, T.PLANE, L * 3, rules, -1).forEach(push);
  for (let L = 2; L <= 4; L++) genCombos(hand, T.PLANE1, L * 4, rules, -1).forEach(push);
  for (let L = 2; L <= 3; L++) genCombos(hand, T.PLANE2, L * 5, rules, -1).forEach(push);
  genCombos(hand, T.FOUR2, 6, rules, -1).forEach(push);
  genCombos(hand, T.FOUR2PAIR, 8, rules, -1).forEach(push);
  if (rules.flushStraight) {
    for (let L = rules.minStraight; L <= 12; L++) genCombos(hand, T.FLUSH, L, rules, -1).forEach(push);
  }
  if (rules.fiftyK) genCombos(hand, T.FIFTYK, 3, rules, -1).forEach(push);

  return dedupe(res);
}

module.exports = {
  T: T,
  TYPE_NAME: TYPE_NAME,
  typeName: typeName,
  analyze: analyze,
  canBeat: canBeat,
  isBombType: isBombType,
  genCombos: genCombos,
  findBeats: findBeats,
  leadCandidates: leadCandidates,
  dedupe: dedupe,
};
