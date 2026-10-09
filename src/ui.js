'use strict';

const readline = require('readline');
const C = require('./core/cards');
const combo = require('./core/combo');
const color = require('./color');
const skins = require('./skins');

/* ------------------------------------------------------------------ */
/* 颜色（统一由 color.js 提供，便于伪装皮肤复用）                     */
/* ------------------------------------------------------------------ */

const red = color.red;
const bold = color.bold;
const dim = color.dim;
const cyan = color.cyan;
const yellow = color.yellow;
const green = color.green;
const useColor = color.isEnabled();

/* ------------------------------------------------------------------ */
/* 牌面渲染                                                           */
/* ------------------------------------------------------------------ */

let ASCII = false;
function setAscii(v) { ASCII = !!v; }

function cardText(c) {
  if (c.r >= 16) {
    return c.r === 17 ? red(bold(ASCII ? 'W' : '\u5927\u738b')) : cyan(bold(ASCII ? 'w' : '\u5c0f\u738b'));
  }
  const t = C.cardStr(c, ASCII);
  const isRed = (c.s === 1 || c.s === 3);
  return isRed ? red(bold(t)) : t;
}

function cardTextCompact(c) {
  if (c.r >= 16) return c.r === 17 ? red('W') : cyan('w');
  const t = C.cardStr(c, ASCII);
  return (c.s === 1 || c.s === 3) ? red(t) : t;
}

function handText(cards) {
  return cards.map(cardTextCompact).join(' ');
}

const TYPE_NAME = combo.TYPE_NAME;

/* ------------------------------------------------------------------ */
/* 主渲染                                                             */
/* ------------------------------------------------------------------ */

const LINE = '\u2500'.repeat(58);

function renderTable(view, seat, opts) {
  opts = opts || {};
  const out = [];
  const n = view.seats.length;

  out.push('');
  // 标题行
  let title = ' ' + view.name;
  if (view.extra && view.extra.baseScore) title += ' · 底分 ' + view.extra.baseScore;
  if (view.extra && view.extra.multiplier > 1) title += ' · 倍数 x' + view.extra.multiplier;
  if (view.phase === 'bid') title += ' · 叫分中';
  out.push(bold(title));

  // 座位行
  const seatParts = [];
  for (let i = 0; i < n; i++) {
    const s = view.seats[i];
    const bits = [];
    if (s.isYou) bits.push(green('[你]'));
    else if (s.bot) bits.push(dim('(电脑)'));
    bits.push(bold(s.name));
    if (s.role) bits.push(s.role === '地主' ? yellow(s.role) : dim(s.role));
    bits.push(s.count + '张');
    let line = bits.join(' ');
    if (s.out) line += green(' 已出完');
    const mark = (view.turn === i && !view.over) ? bold('>') : ' ';
    seatParts.push(mark + ' ' + line);
  }
  out.push(seatParts.join('  |  '));

  // 底牌
  if (view.bottom) {
    out.push(' 底牌: ' + handText(view.bottom));
  }

  out.push(' ' + LINE);

  // 最近出牌
  const hist = view.history || [];
  const plays = [];
  for (let i = hist.length - 1; i >= 0 && plays.length < 6; i--) {
    const h = hist[i];
    if (h.kind === 'bid') {
      plays.unshift('  ' + pad(view.seats[h.seat].name, 6) + (h.score ? '叫 ' + h.score + ' 分' : '不叫'));
    } else if (h.kind === 'landlord') {
      plays.unshift('  ' + pad(view.seats[h.seat].name, 6) + yellow('抢到地主'));
    } else if (h.kind === 'pass') {
      plays.unshift('  ' + pad(view.seats[h.seat].name, 6) + dim('不要'));
    } else if (h.kind === 'play') {
      plays.unshift('  ' + pad(view.seats[h.seat].name, 6) + '出  ' +
        handText(h.cards) + '   ' + dim(TYPE_NAME[h.type] || ''));
    } else if (h.kind === 'score') {
      plays.unshift('  ' + pad(view.seats[h.seat].name, 6) + yellow('收分 +' + h.points));
    } else if (h.kind === 'bomb') {
      plays.unshift('  ' + pad(view.seats[h.seat].name, 6) + red('炸弹 x2!'));
    }
  }
  out.push(' 最近:');
  if (!plays.length) out.push(dim('   （暂无）'));
  else out.push.apply(out, plays);

  out.push(' ' + LINE);

  // 场上最大的一手
  const mid = [];
  if (view.last) {
    mid.push(' 场上最大: ' + view.seats[view.last.seat].name + ' 的 ' +
      handText(view.last.cards) + '  ' + dim(TYPE_NAME[view.last.type] || ''));
  } else if (view.phase === 'play' && !view.over) {
    mid.push(dim(' 场上最大: 无（自由出牌）'));
  } else if (view.phase === 'bid') {
    mid.push(dim(' 叫分阶段：依次叫 1/2/3 分或不叫，最高者当地主'));
  }
  if (mid.length) out.push.apply(out, mid);

  if (view.over && view.result) {
    out.push(' ' + LINE);
    let t = ' 结果: ' + (view.result.text || '');
    out.push(yellow(bold(t)));
    const scores = [];
    for (let i = 0; i < n; i++) {
      const s = view.seats[i];
      if (s.score) scores.push(s.name + ' ' + (s.score > 0 ? '+' + s.score : s.score));
      else scores.push(s.name + ' 0');
    }
    out.push(' 分数: ' + scores.join('   '));
  }

  // 自己手牌
  if (seat >= 0 && view.hand) {
    out.push(' ' + LINE);
    out.push(' 你的手牌 (' + view.hand.length + '张):');
    out.push('  ' + handText(view.hand));
  }
  out.push('');
  return out.join('\n');
}

function pad(s, n) {
  let len = 0;
  for (let i = 0; i < s.length; i++) len += /[\u4e00-\u9fa5\uff00-\uffef]/.test(s[i]) ? 2 : 1;
  let r = s;
  while (len < n) { r += ' '; len++; }
  return r;
}

/* ------------------------------------------------------------------ */
/* 输入解析                                                           */
/* ------------------------------------------------------------------ */

const SUIT_ALIAS = {
  s: 0, S: 0, h: 1, H: 1, c: 2, C: 2, d: 3, D: 3,
  '\u2660': 0, '\u2665': 1, '\u2663': 2, '\u2666': 3,
};

/**
 * 把 "34567" / "3 4 5 6 7" / "3s 3h" / "50K" 解析成手牌中的实际牌
 * @returns {{ok:boolean, ids?:number[], err?:string}}
 */
function parseCardInput(input, hand) {
  const s = String(input || '');
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === ' ' || ch === '\t' || ch === ',' || ch === '\uff0c' || ch === '/' || ch === '|') { i++; continue; }
    let rank = null;
    if (ch >= '3' && ch <= '9') { rank = ch.charCodeAt(0) - 48; i++; }
    else if (ch === '1' && s[i + 1] === '0') { rank = 10; i += 2; }
    else if (ch === '0') { rank = 10; i++; }
    else if (ch === 'j' || ch === 'J') { rank = 11; i++; }
    else if (ch === 'q' || ch === 'Q') { rank = 12; i++; }
    else if (ch === 'k' || ch === 'K') { rank = 13; i++; }
    else if (ch === 'a' || ch === 'A') { rank = 14; i++; }
    else if (ch === '2') { rank = 15; i++; }
    else if (ch === 'w' || ch === 'x') { rank = 16; i++; }
    else if (ch === 'W' || ch === 'X') { rank = 17; i++; }
    else {
      return { ok: false, err: '看不懂的字符 "' + ch + '"（牌面用 3-9 0 J Q K A 2 w W 表示）', en: 'unknown char "' + ch + '"' };
    }
    let suit = -1;
    if (i < s.length && SUIT_ALIAS[s[i]] !== undefined) {
      suit = SUIT_ALIAS[s[i]];
      i++;
    }
    tokens.push({ rank: rank, suit: suit });
  }
  if (!tokens.length) return { ok: false, err: '没有输入任何牌', en: 'no cards entered' };

  const used = new Set();
  const picked = [];

  const take = function (rank, suit) {
    for (let j = 0; j < hand.length; j++) {
      const c = hand[j];
      if (used.has(c.id)) continue;
      if (c.r !== rank) continue;
      if (suit >= 0 && c.s !== suit) continue;
      used.add(c.id);
      return c;
    }
    return null;
  };

  // 尝试用同一花色取齐所有牌；失败则回滚
  const trySuit = function (suit) {
    const cs = [];
    for (let k = 0; k < tokens.length; k++) {
      const c = take(tokens[k].rank, suit);
      if (!c) {
        cs.forEach(function (x) { used.delete(x.id); });
        return null;
      }
      cs.push(c);
    }
    return cs;
  };

  // 1) 同花顺 / 五十K：若是这些形状且未指定花色，先找同一花色
  const ranks = tokens.map(function (t) { return t.rank; }).sort(function (a, b) { return a - b; });
  const noSuit = tokens.every(function (t) { return t.suit < 0; });
  let commonSuitTried = false;
  if (noSuit && ranks.length === 3 && ranks[0] === 5 && ranks[1] === 10 && ranks[2] === 13) {
    for (let sIdx = 0; sIdx < 4 && !commonSuitTried; sIdx++) {
      const cs = trySuit(sIdx);
      if (cs) { commonSuitTried = true; picked.push.apply(picked, cs); }
    }
  }
  if (!commonSuitTried && noSuit && ranks.length >= 5) {
    let seq = true;
    for (let k = 1; k < ranks.length; k++) if (ranks[k] !== ranks[k - 1] + 1) { seq = false; break; }
    if (seq && ranks[0] >= 3 && ranks[ranks.length - 1] <= 14) {
      for (let sIdx = 0; sIdx < 4 && !commonSuitTried; sIdx++) {
        const cs = trySuit(sIdx);
        if (cs) { commonSuitTried = true; picked.push.apply(picked, cs); }
      }
    }
  }

  // 2) 其余逐张取
  if (!commonSuitTried) {
    for (let k = 0; k < tokens.length; k++) {
      const t = tokens[k];
      const c = take(t.rank, t.suit);
      if (!c) {
        const label = C.rankChar(t.rank) + (t.suit >= 0 ? C.SUIT_CHARS[t.suit] : '');
        return { ok: false, err: '手里没有 ' + label + ' 这张牌', en: 'not in hand: ' + C.rankChar(t.rank) };
      }
      picked.push(c);
    }
  }

  return { ok: true, ids: picked.map(function (c) { return c.id; }) };
}

/* ------------------------------------------------------------------ */
/* IO                                                                 */
/* ------------------------------------------------------------------ */

class IO {
  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: !!process.stdout.isTTY,
    });
    this.handler = null;
    this.onClose = null;
    const self = this;
    this.rl.on('line', function (line) {
      const h = self.handler;
      self.handler = null;
      if (h) h(line.trim());
    });
    this.rl.on('close', function () {
      if (self.onClose) self.onClose();
      else process.exit(0);
    });
  }

  ask(prompt, handler) {
    this.handler = handler;
    if (this.rl.terminal) {
      this.rl.setPrompt(prompt || '> ');
      this.rl.prompt();
    } else if (prompt) {
      process.stdout.write(prompt);
    }
  }

  /** 打印一行，不影响正在输入的内容 */
  say(text) {
    if (text === undefined) text = '';
    if (this.rl.terminal) {
      process.stdout.write('\r\u001b[K' + text + '\n');
      if (this.handler) this.rl.prompt(true);
    } else {
      process.stdout.write(text + '\n');
    }
  }

  /** 追加一段多行输出（伪装皮肤用，不清屏） */
  block(text) {
    if (text === undefined || text === null) return;
    const s = String(text).replace(/\n+$/, '');
    if (!s) return;
    if (this.rl.terminal) {
      process.stdout.write('\r\u001b[K');
      process.stdout.write(s + '\n');
      if (this.handler) this.rl.prompt(true);
    } else {
      process.stdout.write(s + '\n');
    }
  }

  clear() {
    if (process.stdout.isTTY && useColor) process.stdout.write('\u001b[2J\u001b[H');
  }

  close() {
    this.rl.close();
  }

  confirm(prompt, handler) {
    this.ask(prompt + ' ', handler);
  }
}

/* ------------------------------------------------------------------ */
/* 伪装皮肤入口                                                       */
/* ------------------------------------------------------------------ */

/**
 * 统一渲染入口：
 *   开了伪装皮肤 -> 让皮肤把状态塞进自己的壳里（返回多行文本，调用方直接追加输出）
 *   没开         -> 返回 null，调用方走原生牌桌 renderTable
 */
function renderSkin(view, seat, opts) {
  return skins.render(view, seat, opts);
}

function setSkin(key) { skins.setKey(key); }
function skinKey() { return skins.getKey(); }
function skinActive() { return skins.isActive(); }
function skinList() { return skins.list(); }
function skinAppends() { return skins.appends(); }
function resetSkin() { skins.reset(); }
function skinPrompt() { return skins.prompt(); }
function skinHelp(rules) { return skins.help(rules); }
function skinMessage(text) { return skins.message(text); }

/* ------------------------------------------------------------------ */

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

module.exports = {
  IO: IO,
  renderTable: renderTable,
  renderSkin: renderSkin,
  setSkin: setSkin,
  skinKey: skinKey,
  skinActive: skinActive,
  skinList: skinList,
  skinAppends: skinAppends,
  resetSkin: resetSkin,
  skinPrompt: skinPrompt,
  skinHelp: skinHelp,
  skinMessage: skinMessage,
  parseCardInput: parseCardInput,
  handText: handText,
  cardTextCompact: cardTextCompact,
  setAscii: setAscii,
  sleep: sleep,
  pad: pad,
  colors: { red: red, bold: bold, dim: dim, cyan: cyan, yellow: yellow, green: green, gray: color.gray },
  color: color,
  hasColor: useColor,
  skins: skins,
};
