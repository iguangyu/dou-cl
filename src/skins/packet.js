'use strict';

/**
 * 状态包：把一局牌的“视野”压成一份与渲染方式无关的数据。
 * 每种伪装皮肤负责把它塞进自己的壳里 —— 但信息一条都不能少：
 *   我的手牌 / 每个人剩几张 / 谁出的什么 / 场上最大 / 轮谁 / 底牌 / 结果与分数
 */

const C = require('../core/cards');

// 中文昵称在伪装皮肤里要转成 ASCII
const ALIAS = {
  '你': 'self', '小美': 'mei', '阿飞': 'fei', '老王': 'wang', '阿强': 'qiang',
};

function isAscii(s) {
  return /^[\x20-\x7e]*$/.test(s);
}

// 角色也要 ASCII 化，否则 hex 转储里会变成一串 '.'
const ROLE_EN = { '地主': 'landlord', '农民': 'farmer' };
function roleEn(r) {
  return ROLE_EN[r] || r || '';
}

function labelFor(view, i, mySeat) {
  if (i === mySeat) return 'self';
  const s = view.seats[i];
  if (!s) return 'p' + i;
  if (isAscii(s.name)) return s.name;
  return ALIAS[s.name] || ('p' + i);
}

/** 牌 -> 两个 ASCII 字符： 3s 0h Jd Qc Ka 2s  w W */
function cardCode(c) {
  if (c.r >= 16) return C.rankChar(c.r);
  return C.rankChar(c.r) + C.SUIT_LETTERS[c.s].toLowerCase();
}

function cardsCode(list) {
  return (list || []).map(cardCode);
}

function historyLine(view, h, label) {
  const who = label(h.seat);
  switch (h.kind) {
    case 'play': return { kind: 'play', who: who, cards: cardsCode(h.cards), type: h.type };
    case 'pass': return { kind: 'pass', who: who };
    case 'bid': return { kind: 'bid', who: who, score: h.score };
    case 'landlord': return { kind: 'landlord', who: who };
    case 'bomb': return { kind: 'bomb', who: who, type: h.type };
    case 'score': return { kind: 'score', who: who, points: h.points };
    default: return null;
  }
}

/** 把一条历史压成极短的一行（hex 皮肤用） */
function historyShort(item) {
  switch (item.kind) {
    case 'play': return item.who + ':play ' + item.cards.join('') + ' [' + item.type + ']';
    case 'pass': return item.who + ':pass';
    case 'bid': return item.who + ':bid ' + item.score;
    case 'landlord': return item.who + ':landlord';
    case 'bomb': return item.who + ':bomb(x2)';
    case 'score': return item.who + ':score +' + item.points;
    default: return item.who + ':' + item.kind;
  }
}

function build(view, seat) {
  const label = function (i) { return labelFor(view, i, seat); };
  const history = (view.history || []).map(function (h) { return historyLine(view, h, label); })
    .filter(Boolean);

  const seats = view.seats.map(function (s, i) {
    return {
      i: i,
      label: label(i),
      name: s.name,
      count: s.count,
      out: !!s.out,
      role: roleEn(s.role),
      team: s.team,
      score: s.score || 0,
      isYou: !!s.isYou,
      isTurn: view.turn === i,
    };
  });

  const last = view.last ? {
    seat: view.last.seat,
    who: label(view.last.seat),
    cards: cardsCode(view.last.cards),
    type: view.last.type,
    count: view.last.cards.length,
  } : null;

  const over = !!view.over;
  let summary = '';
  if (over && view.result) {
    const r = view.result;
    let what = 'finished';
    if (r.winner === 'landlord') what = 'landlord win';
    else if (r.winner === 'farmer') what = 'farmers win';
    else if (r.seat !== undefined) what = 'winner=' + label(r.seat);
    else if (r.type === 'redeal') what = 'redeal';
    const sc = seats.map(function (s) { return s.label + ':' + s.score; }).join(' ');
    summary = what + ' score[' + sc + ']';
    if (r.baseScore) summary += ' base=' + r.baseScore + ' x' + (r.multiplier || 1);
  }

  return {
    game: view.key,
    gameName: view.name,
    phase: view.phase,          // bid | play | over
    over: over,
    seat: seat,
    turn: view.turn,
    turnLabel: label(view.turn),
    isMyTurn: seat >= 0 && view.turn === seat && !over,
    hand: cardsCode(view.hand),
    handCount: (view.hand || []).length,
    seats: seats,
    peers: seats.filter(function (s) { return !s.isYou; }),
    last: last,
    bottom: view.bottom ? cardsCode(view.bottom) : null,
    bottomCount: view.bottomCount || 0,
    history: history,
    result: view.result || null,
    summary: summary,
    canPass: !!view.canPass,
    needSpade3: !!(view.extra && view.extra.needSpade3),
    baseScore: (view.extra && view.extra.baseScore) || 0,
    multiplier: (view.extra && view.extra.multiplier) || 1,
  };
}

module.exports = {
  build: build,
  cardCode: cardCode,
  cardsCode: cardsCode,
  historyShort: historyShort,
  labelFor: labelFor,
};
