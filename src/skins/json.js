'use strict';

/**
 * 皮肤：JSON 应答 / WS 消息 dump
 * 输出是**真·合法 JSON**（去掉颜色后能直接丢给 jq），配色仿 jq。
 */

const color = require('../color');

function two(n) { return n < 10 ? '0' + n : '' + n; }

function iso(ms) {
  const d = new Date(ms);
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const oh = two(Math.floor(Math.abs(off) / 60));
  const om = two(Math.abs(off) % 60);
  return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + 'T' +
    two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds()) + '.' +
    ('00' + d.getMilliseconds()).slice(-3) + sign + oh + ':' + om;
}
function clock(ms) {
  const d = new Date(ms);
  return two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds()) + '.' +
    ('00' + d.getMilliseconds()).slice(-3);
}

function s(v) { return JSON.stringify(String(v)); }
function arr(list) { return '[' + list.map(s).join(', ') + ']'; }

function buildPlain(p, st) {
  const L = [];
  L.push('{');
  L.push('  "ts": ' + s(iso(st.clock)) + ',');
  L.push('  "seq": ' + st.seq + ',');
  L.push('  "pool": ' + s(st.pool) + ',');
  L.push('  "game": ' + s(p.game) + ',');
  L.push('  "phase": ' + s(p.phase) + ',');
  L.push('  "turn": ' + s(p.turnLabel) + ',');
  L.push('  "self": {');
  L.push('    "id": "self",');
  L.push('    "pending": ' + (p.isMyTurn ? 'true' : 'false') + ',');
  L.push('    "hand": ' + arr(p.hand) + ',');
  L.push('    "hold": ' + p.hand.length);
  L.push('  },');
  L.push('  "peers": [');
  p.peers.forEach(function (x, i) {
    L.push('    { "id": ' + s(x.label) + ', "hold": ' + x.count +
      (x.role ? ', "role": ' + s(x.role) : '') +
      ', "out": ' + (x.out ? 'true' : 'false') +
      ', "score": ' + x.score + ' }' + (i === p.peers.length - 1 ? '' : ','));
  });
  L.push('  ],');
  if (p.last) {
    L.push('  "table": { "by": ' + s(p.last.who) + ', "cards": ' + arr(p.last.cards) +
      ', "type": ' + s(p.last.type) + ' },');
  } else {
    L.push('  "table": null,');
  }
  if (p.bottom) L.push('  "bottom": ' + arr(p.bottom) + ',');
  L.push('  "recent": [');
  p.history.slice(-7).forEach(function (h, i, a) {
    let o;
    if (h.kind === 'play') o = '{ "by": ' + s(h.who) + ', "action": "play", "cards": ' + arr(h.cards) + ', "type": ' + s(h.type) + ' }';
    else if (h.kind === 'pass') o = '{ "by": ' + s(h.who) + ', "action": "pass" }';
    else if (h.kind === 'bid') o = '{ "by": ' + s(h.who) + ', "action": "bid", "score": ' + h.score + ' }';
    else if (h.kind === 'landlord') o = '{ "by": ' + s(h.who) + ', "action": "landlord" }';
    else if (h.kind === 'bomb') o = '{ "by": ' + s(h.who) + ', "action": "bomb", "type": ' + s(h.type) + ' }';
    else if (h.kind === 'score') o = '{ "by": ' + s(h.who) + ', "action": "score", "points": ' + h.points + ' }';
    else o = '{ "by": ' + s(h.who) + ', "action": ' + s(h.kind) + ' }';
    L.push('    ' + o + (i === a.length - 1 ? '' : ','));
  });
  L.push('  ],');
  L.push('  "result": ' + (p.over ? s(p.summary) : 'null'));
  L.push('}');
  return L.join('\n');
}

/* jq 风格配色；hand 区间用另一档颜色 */
const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)/g;

function colorize(json, handSpan) {
  return json.replace(TOKEN, function (m, str, colon, lit, num, offset) {
    const inHand = handSpan && offset >= handSpan.start && offset < handSpan.end;
    if (str) {
      if (colon) return color.cyan(str) + colon;
      return inHand ? color.c256(114, str) : color.green(str);
    }
    if (lit) return color.magenta(lit);
    if (num) return inHand ? color.c256(114, num) : color.yellow(num);
    return m;
  });
}

function handSpanOf(json) {
  const k = json.indexOf('"hand"');
  if (k < 0) return null;
  const open = json.indexOf('[', k);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < json.length; i++) {
    if (json[i] === '[') depth++;
    else if (json[i] === ']') { depth--; if (depth === 0) return { start: open, end: i + 1 }; }
  }
  return null;
}

module.exports = {
  key: 'json',
  name: 'JSON 应答',
  desc: '伪装成 WS 收到的 JSON 帧 + jq 格式化输出（去掉颜色就是合法 JSON）',
  accent: 114,

  header: function () { return null; },

  render: function (p, st) {
    const json = buildPlain(p, st);
    const span = handSpanOf(json);
    const out = [];
    out.push(color.gray(clock(st.clock)) + ' ' + color.gray('DEBUG'.padEnd(5)) + ' ' +
      color.dim('[' + 'ws-client'.padEnd(10) + ']') + ' ' +
      color.dim('<- ') + '{' + '"type":"deck.state","seq":' + st.seq + '}');
    out.push(colorize(json, span));
    if (p.over) {
      out.push(color.gray(clock(st.clock + 2)) + ' ' + color.yellow('WARN '.padEnd(5)) + ' ' +
        color.dim('[' + 'ws-client'.padEnd(10) + ']') + ' ' +
        color.dim('session closed: ' + p.summary));
    }
    return out.join('\n') + '\n';
  },

  prompt: function () {
    return color.dim('node') + color.gray(' > ');
  },

  help: function (lines) {
    const out = [];
    out.push(color.dim('// deck-sync 本地调试，未接入线上'));
    out.push('');
    lines.forEach(function (l) { out.push(color.dim('//   ' + l)); });
    out.push('');
    out.push(color.dim('//   出牌 34567 / 3 4 5 6 7     带花色 5s 5h'));
    out.push(color.dim('//   pass | p    hint | h    redraw    reveal    skin <名>    quit'));
    return out.join('\n') + '\n';
  },

  message: function (text) {
    return color.gray(clock(Date.now())) + ' ' + color.gray('DEBUG'.padEnd(5)) + ' ' +
      color.dim('[' + 'ws-client'.padEnd(10) + '] ') + color.dim(String(text)) + '\n';
  },
};
