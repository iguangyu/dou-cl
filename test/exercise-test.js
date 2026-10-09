'use strict';

/* 训练模式自测：四个项目都能跑完、判分逻辑站得住 */

process.env.DOUCL_NO_WIPE = '1';   // 别在测试输出里刷屏

const ex = require('../src/exercise');
const C = require('../src/core/cards');
const combo = require('../src/core/combo');
const rulesMod = require('../src/core/rules');
const gamesMod = require('../src/games');
const bot = require('../src/bot');
const ui = require('../src/ui');
const color = require('../src/color');

color.setEnabled(false);   // 断言时不带 ANSI

let fails = 0;
function ok(cond, msg) {
  console.log((cond ? '  \u2713 ' : '  \u2717 ') + msg);
  if (!cond) fails++;
}

const I = ex._internals;
const FULL = C.createDeck({ decks: 1, jokers: true });

function stubIO(answers) {
  let i = 0;
  return {
    handler: null,
    clear: function () {},
    say: function () {},
    block: function () {},
    close: function () {},
    ask: function (prompt, handler) {
      const a = answers[i++ % answers.length];
      setImmediate(function () { handler(a); });
    },
  };
}

/** 会收集输出、并按 getAnswer(本次输出) 作答的桩 */
function captureIO(getAnswer) {
  const buf = [];
  return {
    handler: null,
    clear: function () {},
    block: function () {},
    close: function () {},
    say: function (t) { buf.push(String(t)); },
    ask: function (prompt, handler) {
      const text = buf.join('\n');
      buf.length = 0;
      const a = getAnswer(text);
      setImmediate(function () { handler(a); });
    },
  };
}

/* ---------------- 静态判分逻辑 ---------------- */

function testUnits() {
  console.log('\n[unit] 判分 / 出题逻辑');

  const engine = gamesMod.create('doudizhu');
  const players = [{ name: 'me', bot: true }, { name: 'p1', bot: true }, { name: 'p2', bot: true }];
  const st = engine.start(players);
  let g = 0;
  while (st.phase === 'bid' && !st.over && g++ < 20) {
    engine.apply(st, st.turn, bot.chooseAction(engine, st, st.turn));
  }
  for (let m = 0; m < 12 && !st.over; m++) {
    const s = engine.asker(st);
    if (s === null) break;
    engine.apply(st, s, bot.chooseAction(engine, st, s));
  }
  ok(!st.over, '造出了一个中局（叫分结束 + 走了 12 手）');

  let hiddenOk = true, sumOk = true;
  for (let r = 3; r <= 17; r++) {
    const h = I.hiddenOf(st, r);
    const total = (r >= 16) ? 1 : 4;
    if (h.total !== total) sumOk = false;
    if (h.shown + h.hidden !== h.total) sumOk = false;

    const seen = new Set();
    st.seats[0].hand.forEach(function (x) { seen.add(x.id); });
    st.history.forEach(function (hh) {
      if (hh.kind === 'play' && hh.cards) hh.cards.forEach(function (x) { seen.add(x.id); });
    });
    if (st.bottomRevealed) st.bottom.forEach(function (x) { seen.add(x.id); });
    const real = FULL.filter(function (x) { return x.r === r && !seen.has(x.id); }).length;
    if (real !== h.hidden) hiddenOk = false;
  }
  ok(sumOk, 'hiddenOf：每个点数 总数 == 已露面 + 没露面');
  ok(hiddenOk, 'hiddenOf：没露面的张数与按 id 手工核对一致');

  const rules = rulesMod.get('doudizhu');
  let scOk = true, scCount = 0, minBeats = Infinity;
  for (let i = 0; i < 200; i++) {
    const sc = I.makeScenario(rules);
    if (!sc) continue;
    scCount++;
    minBeats = Math.min(minBeats, sc.beats.length);
    const a = combo.analyze(sc.target.cards, rules);
    if (!a) { scOk = false; break; }
    if (!combo.canBeat(sc.beats[0].combo, a, rules)) { scOk = false; break; }
    if (sc.hand.length < 10 || sc.hand.length > 14) { scOk = false; break; }
  }
  ok(scCount >= 190, 'makeScenario：200 次里造出 ' + scCount + ' 道题（≥190）');
  ok(scOk, 'makeScenario：每道题的牌型合法、且有牌能管上');
  ok(minBeats >= 2, 'makeScenario：每道题至少有 2 个选择（最少的一次 ' + minBeats + ' 个）');

  ok(I.followCost([{}, {}], { main: 5, len: 2, type: combo.T.PAIR }) <
    I.followCost([{}, {}], { main: 14, len: 2, type: combo.T.PAIR }), 'followCost：小牌代价 < 大牌代价');
  ok(I.followCost([{}], { main: 14, len: 1, type: combo.T.SINGLE }) >
    I.followCost([{}, {}], { main: 14, len: 2, type: combo.T.PAIR }), 'followCost：同样的牌，出得多代价更低');
  ok(I.followCost([{}, {}, {}, {}], { main: 5, len: 4, type: combo.T.BOMB }) > 100,
    'followCost：炸弹带 +100');

  let refOk = true;
  for (let i = 0; i < 300; i++) {
    const deck = C.shuffle(C.createDeck({ decks: 1, jokers: true }));
    const d = I.strengthDetail(deck.slice(0, 17));
    if (d.ref < 0 || d.ref > 3 || !isFinite(d.score)) { refOk = false; break; }
  }
  ok(refOk, 'strengthDetail：300 手随机牌，参考答案都是 0..3 且分数有限');
}

/* ---------------- 四个项目都能跑完 ---------------- */

async function testDrills() {
  console.log('\n[drill] 四项都跑得通');

  const fast = { speed: 150 };

  const r1 = await I.count(stubIO(['1', '2', '0']), fast, 3);
  ok(r1 && r1.full === 300, 'count 跑完 3 题（full=' + (r1 && r1.full) + '）');

  const r2 = await I.flash(stubIO(['1', 'n', '3s', 'A', 'n']), { speed: 1000 }, 3);
  ok(r2 && r2.full === 600, 'flash 跑完 3 题 × 2 问（full=' + (r2 && r2.full) + '）');

  const r3 = await I.bestplay(stubIO(['p', 'p', 'p']), fast, 3);
  ok(r3 && r3.full === 300, 'bestplay 跑完 3 题（full=' + (r3 && r3.full) + '）');

  const r4 = await I.bid(stubIO(['2', '1', '3']), fast, 3);
  ok(r4 && r4.full === 300, 'bid 跑完 3 题（full=' + (r4 && r4.full) + '）');

  const r6 = await I.count(stubIO(['quit']), fast, 3);
  ok(r6 === null, 'count：输入 quit 立刻返回 null');

  // flash：牌面确实是 ASCII 两个字符的写法，且能被 parseCardInput 解析回来
  let flashed = null;
  await I.flash({
    handler: null, clear: function () {}, block: function () {}, close: function () {},
    say: function (t) { if (!flashed && /[0-9JQKA2wW][shcd]?(\s|$)/.test(t) && t.indexOf('──') < 0) flashed = t; },
    ask: function (p, h) { setImmediate(function () { h('0'); }); },
  }, { speed: 1000 }, 1);
  const shown = flashed ? flashed.trim().split(/\s+/) : [];
  const parsed = shown.length ? ui.parseCardInput(shown.join(' '), FULL) : { ok: false };
  ok(shown.length === 7 && parsed.ok && parsed.ids.length === 7,
    'flash：显示的 7 张是 ASCII 码且能原样解析回来（' + shown.join(' ') + '）');

  // bid：把打印出来的手牌抓回来，按参考答案作答 → 应该全对
  const r5 = await I.bid(captureIO(function (text) {
    const m = /17 cards\s+(.+)$/m.exec(text);
    if (!m) return '0';
    const p = ui.parseCardInput(m[1].trim(), FULL);
    if (!p.ok) return '0';
    const hand = FULL.filter(function (x) { return p.ids.indexOf(x.id) >= 0; });
    return String(I.strengthDetail(hand).ref);
  }), fast, 5);
  ok(r5 && r5.score === 500, 'bid：照着参考答案答，5 题全对（score=' + (r5 && r5.score) + '）');
}

async function main() {
  testUnits();
  await testDrills();
  console.log('');
  if (fails) { console.log(fails + ' 项失败'); process.exit(1); }
  console.log('训练模式自测通过。');
  process.exit(0);
}

main().catch(function (e) { console.error(e); process.exit(1); });
