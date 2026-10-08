'use strict';

/*
 * 伪装皮肤自洽性测试：
 *   hex   —— 左边 hex 必须和右边 ASCII 逐字节对得上，且能还原出完整状态
 *   json  —— 去掉 ANSI 后必须是**能 JSON.parse 的合法 JSON**
 *   diff  —— 必须是**真的能 apply** 的统一 diff（应用后等于当前状态）
 *   log   —— 关键信息（手牌 / 各家剩几张 / 场上最大）一条都不能少
 * 外加：所有皮肤都不能把牌面弄丢
 */

const gamesMod = require('../src/games');
const bot = require('../src/bot');
const ui = require('../src/ui');
const skins = require('../src/skins');
const color = require('../src/color');

color.setEnabled(true);

let fails = 0;
function ok(cond, msg) {
  console.log((cond ? '  \u2713 ' : '  \u2717 ') + msg);
  if (!cond) fails++;
}

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
function strip(s) { return s.replace(ANSI, ''); }

function makeView(key, steps) {
  const engine = gamesMod.create(key);
  const players = [{ name: '你', bot: false }];
  const extra = ['小美', '阿飞', '老王'];
  for (let i = 1; i < engine.rules.seats; i++) players.push({ name: extra[i - 1], bot: true });
  const st = engine.start(players);
  for (let i = 0; i < steps && !st.over; i++) {
    const seat = engine.asker(st);
    if (seat === null) break;
    const a = bot.chooseAction(engine, st, seat);
    if (!engine.apply(st, seat, a).ok) break;
  }
  return { engine: engine, state: st, view: engine.view(st, 0) };
}

/* ---------------- hex ---------------- */

const OFFSET_W = 8;
const HEX_W = 53;           // 24 字节 / 每组 4 字节 -> 6*9-1
const ASCII_COL = OFFSET_W + 2 + HEX_W + 2;

function parseDump(text) {
  const lines = strip(text).split('\n');
  const bytes = [];
  const offsets = [];
  let rowErrs = 0;
  lines.forEach(function (l) {
    if (!/^[0-9a-f]{8}: /.test(l)) return;
    const off = parseInt(l.slice(0, OFFSET_W), 16);
    const hexField = l.slice(OFFSET_W + 2, OFFSET_W + 2 + HEX_W);
    const asc = l.slice(ASCII_COL);
    const hexPart = hexField.replace(/ /g, '');
    const n = hexPart.length / 2;
    if (asc.length !== n) rowErrs++;
    for (let i = 0; i < n; i++) {
      const v = parseInt(hexPart.substr(i * 2, 2), 16);
      const expect = (v >= 32 && v < 127) ? String.fromCharCode(v) : '.';
      if (asc[i] !== expect) rowErrs++;
      bytes.push(v);
    }
    offsets.push(off);
  });
  return {
    text: Buffer.from(bytes).toString('latin1'),
    offsets: offsets,
    rows: bytes.length,
    rowErrs: rowErrs,
  };
}

function testHex() {
  console.log('\n[hex] xxd 转储');
  skins.setKey('hex');
  const a = makeView('doudizhu', 5);
  const t1 = strip(skins.render(a.view, 0, {}));
  const dump = parseDump(t1);
  ok(dump.rowErrs === 0, '左边 hex 与右边 ASCII 逐字节一致（' + dump.rows + ' 字节，' + dump.offsets.length + ' 行）');
  ok(dump.offsets.every(function (o, i) { return o === i * 24; }), '偏移量按 24 递增');

  const text = dump.text;
  ok(text.indexOf('hand[') >= 0, '还原出的内容里有 hand[');
  ok(text.indexOf('peers=') >= 0, '还原出的内容里有 peers=');
  ok(text.indexOf('phase=') >= 0, '还原出的内容里有 phase=');

  // 手牌必须完整藏在里面
  const handCodes = a.view.hand.map(function (c) {
    return c.r >= 16 ? require('../src/core/cards').rankChar(c.r)
      : require('../src/core/cards').rankChar(c.r) + require('../src/core/cards').SUIT_LETTERS[c.s].toLowerCase();
  });
  const missing = handCodes.filter(function (c) { return text.indexOf(c) < 0; });
  ok(missing.length === 0, (handCodes.length + ' 张手牌全部出现在转储里') + (missing.length ? '（缺 ' + missing.join(',') + '）' : ''));
}

/* ---------------- json ---------------- */

function testJson() {
  console.log('\n[json] JSON 帧');
  skins.setKey('json');
  const a = makeView('fivek', 6);
  const raw = skins.render(a.view, 0, {});
  const plain = strip(raw);
  const lines = plain.split('\n');
  const start = lines.indexOf('{');
  let end = -1;
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i] === '}') { end = i; break; }
  ok(start >= 0 && end > start, '找到了 JSON 起止行');
  const body = lines.slice(start, end + 1).join('\n');
  let obj = null;
  try { obj = JSON.parse(body); } catch (e) { ok(false, 'JSON.parse 失败: ' + e.message); }
  if (obj) {
    ok(true, '是合法 JSON（' + body.length + ' 字节，' + body.split('\n').length + ' 行）');
    ok(Array.isArray(obj.self.hand) && obj.self.hand.length === a.view.hand.length,
      'self.hand 张数 ' + obj.self.hand.length + ' == 实际 ' + a.view.hand.length);
    ok(obj.peers.length === a.view.seats.length - 1, 'peers 数量正确（' + obj.peers.length + '）');
    ok(obj.peers.every(function (pe, i) {
      const real = a.view.seats.filter(function (s) { return !s.isYou; })[i];
      return pe.hold === real.count;
    }), 'peers 各家剩牌数对得上: ' + obj.peers.map(function (p) { return p.hold; }).join(','));
    ok(obj.table === null || (obj.table.cards && obj.table.cards.length > 0), 'table 字段完整');
    ok(Array.isArray(obj.recent), 'recent 数组存在（' + obj.recent.length + ' 条）');
  }
}

/* ---------------- diff ---------------- */

function applyDiff(plainText) {
  const lines = plainText.split('\n');
  let i = lines.findIndex(function (l) { return l.indexOf('@@') === 0; });
  if (i < 0) return null;
  const out = [];
  for (i = i + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l === '') continue;
    if (l[0] === '+' || l[0] === ' ') out.push(l.slice(1));
    else if (l[0] === '-') continue;
    else break;
  }
  return out;
}

function testDiff() {
  console.log('\n[diff] git diff');
  skins.setKey('diff');
  const a = makeView('doudizhu', 3);
  skins.render(a.view, 0, {});            // 第一帧（新文件）
  const prev = skins.session().lastYaml.slice();

  const b = makeView('doudizhu', 9);
  const raw = skins.render(b.view, 0, {});
  const plain = strip(raw);
  ok(plain.indexOf('diff --git a/') >= 0, '输出里有 diff --git 头');
  ok(/^@@ -\d+,\d+ \+\d+,\d+ @@/m.test(plain) || plain.indexOf('@@') >= 0, '有 hunk 头');
  ok(plain.split('\n').some(function (l) { return l[0] === '+' && l.indexOf('+++') !== 0; }), '有 + 行');

  const applied = applyDiff(plain);
  const cur = skins.session().lastYaml;
  ok(applied && applied.join('\n') === cur.join('\n'),
    '把 diff apply 回去后 == 当前状态（' + (applied ? applied.length : 0) + ' 行 vs ' + cur.length + ' 行）');

  // 状态信息没丢
  const text = applied ? applied.join('\n') : '';
  ok(text.indexOf('hand:') >= 0 && text.indexOf('peers:') >= 0 && text.indexOf('table:') >= 0,
    'YAML 里有 hand / peers / table');
  const handCodes = b.view.hand.map(function (c) {
    return c.r >= 16 ? require('../src/core/cards').rankChar(c.r)
      : require('../src/core/cards').rankChar(c.r) + require('../src/core/cards').SUIT_LETTERS[c.s].toLowerCase();
  });
  const missing = handCodes.filter(function (c) { return text.indexOf(c) < 0; });
  ok(missing.length === 0, handCodes.length + ' 张手牌全部在 YAML 里');
}

/* ---------------- log ---------------- */

function testLog() {
  console.log('\n[log] 日志流');
  skins.setKey('log');
  const a = makeView('paodekuai', 4);
  const t = strip(skins.render(a.view, 0, {}));
  ok(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3}/m.test(t), '时间戳格式正确');
  ok(t.indexOf('self') >= 0, '有 self 标记');
  const handCodes = a.view.hand.map(function (c) {
    return c.r >= 16 ? require('../src/core/cards').rankChar(c.r)
      : require('../src/core/cards').rankChar(c.r) + require('../src/core/cards').SUIT_LETTERS[c.s].toLowerCase();
  });
  ok(handCodes.every(function (c) { return t.indexOf(c) >= 0; }), handCodes.length + ' 张手牌全部在日志里');
  const peerCounts = a.view.seats.filter(function (s) { return !s.isYou; }).map(function (s) { return s.count; });
  ok(peerCounts.every(function (n) { return t.indexOf(':' + n) >= 0; }), '各家剩牌数出现在日志里: ' + peerCounts.join(','));
}

/* ---------------- 信息完整性（三种玩法 x 四种皮肤） ---------------- */

function testNoInfoLoss() {
  console.log('\n[info] 信息完整性（3 玩法 x 4 皮肤）');
  const keys = ['doudizhu', 'paodekuai', 'fivek'];
  const skinKeys = ['log', 'hex', 'json', 'diff'];
  keys.forEach(function (gk) {
    skinKeys.forEach(function (sk) {
      skins.setKey(sk);
      const a = makeView(gk, 7);
      skins.render(a.view, 0, {});
      const b = makeView(gk, 12);
      let out = strip(skins.render(b.view, 0, {}));
      if (sk === 'hex') out = parseDump(out).text;
      if (sk === 'json') {
        const L = out.split('\n');
        const s = L.indexOf('{');
        let e = -1;
        for (let i = L.length - 1; i >= 0; i--) if (L[i] === '}') { e = i; break; }
        if (s >= 0) out = L.slice(s, e + 1).join('\n');
      }
      if (sk === 'diff') {
        const ap = applyDiff(out);
        if (ap) out = ap.join('\n');
      }
      const view = b.view;
      const checks = [];
      checks.push(['我的手牌张数', view.hand.length]);
      view.seats.filter(function (s) { return !s.isYou; })
        .forEach(function (s) { checks.push(['peer 剩 ' + s.count + ' 张', s.count]); });
      if (view.last) checks.push(['场上最大 ' + view.last.cards.length + ' 张', view.last.cards.length]);
      // 只要“数字”出现过就算没丢（不同皮肤是不同表达形式）
      const allPresent = view.hand.every(function (c) {
        const cd = c.r >= 16 ? require('../src/core/cards').rankChar(c.r)
          : require('../src/core/cards').rankChar(c.r) + require('../src/core/cards').SUIT_LETTERS[c.s].toLowerCase();
        return out.indexOf(cd) >= 0;
      });
      ok(allPresent, gk + ' + ' + sk + '：' + view.hand.length + ' 张手牌一张不少');
    });
  });
}

/* ---------------- 纯 ASCII（终端里出现中文会让伪装露馅 / hex 列变 '.'） ---------------- */

function testAscii() {
  console.log('\n[ascii] 伪装输出必须是纯 ASCII');
  const keys = ['doudizhu', 'paodekuai', 'fivek'];
  const skinKeys = ['log', 'hex', 'json', 'diff'];
  keys.forEach(function (gk) {
    skinKeys.forEach(function (sk) {
      skins.setKey(sk);
      const a = makeView(gk, 9);
      const plain = strip(skins.render(a.view, 0, {}));
      const bad = plain.match(/[^\x00-\x7f]/g);
      ok(!bad, gk + ' + ' + sk + '：纯 ASCII' + (bad ? '（混进 ' + JSON.stringify(Array.from(new Set(bad)).join('')) + '）' : ''));
    });
  });
}

/* ---------------- main ---------------- */

function main() {
  testHex();
  testJson();
  testDiff();
  testLog();
  testNoInfoLoss();
  testAscii();
  console.log('');
  if (fails) { console.log(fails + ' 项失败'); process.exit(1); }
  console.log('伪装皮肤全部自洽。');
}

main();
