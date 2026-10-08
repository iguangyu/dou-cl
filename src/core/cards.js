'use strict';

/**
 * 牌模型
 *   rank: 3..15 表示 3..2 ；16 = 小王 ；17 = 大王
 *   suit: 0=♠ 1=♥ 2=♣ 3=♦ ；-1 = 王
 *   deck: 第几副牌（510K 用两副）
 *
 * 显示约定（按用户要求，只用一个字符表示点数）：
 *   3 4 5 6 7 8 9 0 J Q K A 2  w W
 *   '0' 表示 10，'w' 小王，'W' 大王
 */

const SUIT_CHARS = ['\u2660', '\u2665', '\u2663', '\u2666']; // ♠ ♥ ♣ ♦
const SUIT_LETTERS = ['S', 'H', 'C', 'D'];
// 花色大小（仅 510K 的五十K/同花顺比大小用）：♠ > ♥ > ♣ > ♦
const SUIT_POWER = [4, 3, 2, 1];

const RANK_CHAR = {
  3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
  10: '0', 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2',
  16: 'w', 17: 'W',
};

const RANK_LABEL = {
  11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2', 16: '小王', 17: '大王',
};

const SUIT_NAME = ['黑桃', '红桃', '梅花', '方块'];

function rankChar(r) {
  return RANK_CHAR[r] || String(r);
}

function rankLabel(r) {
  return RANK_LABEL[r] || String(r);
}

function isJoker(c) {
  return c.r >= 16;
}

function createCard(r, s, d, id) {
  return { r, s, d: d || 0, id };
}

/**
 * 生成一副/多副牌
 * opts.decks    副数（默认 1）
 * opts.jokers   是否包含大小王（默认 true）
 * opts.dropRanks 需要剔除的点数数组
 */
function createDeck(opts) {
  opts = opts || {};
  const decks = opts.decks || 1;
  const jokers = opts.jokers !== false;
  const drop = opts.dropRanks || [];
  const cards = [];
  let id = 0;
  for (let d = 0; d < decks; d++) {
    for (let s = 0; s < 4; s++) {
      for (let r = 3; r <= 15; r++) {
        if (drop.indexOf(r) >= 0) continue;
        cards.push(createCard(r, s, d, id++));
      }
    }
    if (jokers) {
      cards.push(createCard(16, -1, d, id++));
      cards.push(createCard(17, -1, d, id++));
    }
  }
  return cards;
}

function shuffle(arr, rand) {
  rand = rand || Math.random;
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

function cardStr(c, ascii) {
  if (c.r >= 16) return RANK_CHAR[c.r];
  const s = ascii ? SUIT_LETTERS[c.s] : SUIT_CHARS[c.s];
  return RANK_CHAR[c.r] + s;
}

function cardsStr(cards, ascii) {
  return cards.map(function (c) { return cardStr(c, ascii); }).join(' ');
}

/** 从大到小（中文牌桌习惯） */
function sortHand(cards) {
  return cards.slice().sort(function (a, b) {
    if (a.r !== b.r) return b.r - a.r;
    return a.s - b.s;
  });
}

/** 从大到小但不带花色排序，用于展示“顺子”类 */
function rankCounts(cards) {
  const m = new Map();
  for (let i = 0; i < cards.length; i++) {
    const r = cards[i].r;
    m.set(r, (m.get(r) || 0) + 1);
  }
  return m;
}

/** 比较两张牌是否“同值”（点数相同） */
function sameRank(a, b) {
  return a.r === b.r;
}

function isSameCard(a, b) {
  return a.id === b.id;
}

/** 手牌分组： rank -> card[] */
function groupByRank(cards) {
  const m = new Map();
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    if (!m.has(c.r)) m.set(c.r, []);
    m.get(c.r).push(c);
  }
  return m;
}

module.exports = {
  SUIT_CHARS: SUIT_CHARS,
  SUIT_LETTERS: SUIT_LETTERS,
  SUIT_POWER: SUIT_POWER,
  SUIT_NAME: SUIT_NAME,
  RANK_CHAR: RANK_CHAR,
  RANK_LABEL: RANK_LABEL,
  rankChar: rankChar,
  rankLabel: rankLabel,
  isJoker: isJoker,
  createCard: createCard,
  createDeck: createDeck,
  shuffle: shuffle,
  cardStr: cardStr,
  cardsStr: cardsStr,
  sortHand: sortHand,
  rankCounts: rankCounts,
  sameRank: sameRank,
  isSameCard: isSameCard,
  groupByRank: groupByRank,
};
