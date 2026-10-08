'use strict';

/* 冒烟测试：渲染 / 输入解析 / 联网全流程 */

const WebSocket = require('ws');
const gamesMod = require('../src/games');
const rulesMod = require('../src/core/rules');
const bot = require('../src/bot');
const ui = require('../src/ui');
const serverMod = require('../src/net/server');

let fails = 0;
function ok(cond, msg) {
  if (cond) { console.log('  \u2713 ' + msg); }
  else { console.log('  \u2717 ' + msg); fails++; }
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/* ---------------- 1. 渲染 ---------------- */

function testRender() {
  console.log('\n[1] 渲染');
  gamesMod.keys.forEach(function (key) {
    const e = gamesMod.create(key);
    const st = e.start([
      { name: '你', bot: false }, { name: '小美', bot: true },
      { name: '阿飞', bot: true }, { name: '老王', bot: true },
    ]);
    // 先走几步，让画面有内容
    for (let i = 0; i < 6 && !st.over; i++) {
      const seat = e.asker(st);
      if (seat === null) break;
      const a = bot.chooseAction(e, st, seat);
      if (!e.apply(st, seat, a).ok) break;
    }
    const view = e.view(st, 0);
    const text = ui.renderTable(view, 0, {});
    ok(text.indexOf('你的手牌') >= 0 && text.length > 100, key + ' 渲染正常（' + text.split('\n').length + ' 行）');
    if (!process.env.QUIET) console.log(text);
  });
}

/* ---------------- 2. 输入解析 ---------------- */

function testParse() {
  console.log('\n[2] 输入解析');
  const rules = rulesMod.get('fivek');
  const C = require('../src/core/cards');
  const hand = [
    C.createCard(3, 0, 0, 1), C.createCard(3, 1, 0, 2),
    C.createCard(5, 0, 0, 3), C.createCard(10, 0, 0, 4), C.createCard(13, 0, 0, 5),
    C.createCard(11, 0, 0, 6), C.createCard(12, 0, 0, 7),
    C.createCard(16, -1, 0, 8), C.createCard(17, -1, 0, 9),
  ];

  let r = ui.parseCardInput('3', hand);
  ok(r.ok && r.ids.length === 1, '单张 "3"');

  r = ui.parseCardInput('33', hand);
  ok(r.ok && r.ids.length === 2, '对子 "33"');

  r = ui.parseCardInput('50K', hand);
  const picked = r.ok ? hand.filter(function (c) { return r.ids.indexOf(c.id) >= 0; }) : [];
  ok(r.ok && picked.length === 3 && picked.every(function (c) { return c.s === 0; }),
    '"50K" 自动挑同花色（五十K）');

  r = ui.parseCardInput('J Q K', hand);
  ok(r.ok && r.ids.length === 3, '带空格的 "J Q K"');

  r = ui.parseCardInput('5s', hand);
  const p2 = r.ok ? hand.filter(function (c) { return r.ids.indexOf(c.id) >= 0; })[0] : null;
  ok(r.ok && p2 && p2.s === 0, '指定花色 "5s"');

  r = ui.parseCardInput('w', hand);
  ok(r.ok && hand.filter(function (c) { return r.ids.indexOf(c.id) >= 0; })[0].r === 16, '小王 "w"');

  r = ui.parseCardInput('W', hand);
  ok(r.ok && hand.filter(function (c) { return r.ids.indexOf(c.id) >= 0; })[0].r === 17, '大王 "W"');

  r = ui.parseCardInput('3s3s', hand);
  ok(!r.ok, '重复选同一张应报错');

  r = ui.parseCardInput('9', hand);
  ok(!r.ok, '手里没有的牌应报错');

  r = ui.parseCardInput('xyz', hand);
  ok(!r.ok, '非法字符应报错');
}

/* ---------------- 3. 联网全流程 ---------------- */

function botClient(port, game, name, bidHigh) {
  return new Promise(function (resolve, reject) {
    const ws = new WebSocket('ws://127.0.0.1:' + port);
    let seat = -1;
    let timer = setTimeout(function () {
      try { ws.close(); } catch (e) { /* ignore */ }
      reject(new Error(name + ' 超时'));
    }, 25000);

    ws.on('open', function () { ws.send(JSON.stringify({ t: 'match', game: game, name: name })); });

    ws.on('message', function (raw) {
      const m = JSON.parse(String(raw));
      if (m.t === 'joined') seat = m.seat;
      if (m.t === 'state') {
        const v = m.view;
        if (v.over) {
          clearTimeout(timer);
          if (seat === 0) ws.send(JSON.stringify({ t: 'again', yes: false }));
          try { ws.close(); } catch (e) { /* ignore */ }
          resolve({ name: name, seat: seat, result: v.result });
          return;
        }
        if (v.turn !== seat) return;
        let action;
        if (v.phase === 'bid') {
          action = { type: 'bid', score: bidHigh ? 3 : 0 };
        } else {
          action = bot.hintFromView(v, seat);
        }
        ws.send(JSON.stringify({ t: 'act', action: action }));
      }
      if (m.t === 'error') console.log('   [' + name + '] server error: ' + m.msg);
    });
    ws.on('error', function (e) { clearTimeout(timer); reject(e); });
  });
}

async function testNet() {
  console.log('\n[3] 联网（服务器 + 3 个客户端自动打一局）');
  const port = 18100 + Math.floor(Math.random() * 200);
  const srv = serverMod.createServer({
    port: port, host: '127.0.0.1', quiet: true, matchSeconds: 1,
    botDelay: 1, turnTimeout: 8000,
  });
  await sleep(400);
  try {
    const res = await Promise.all([
      botClient(port, 'doudizhu', 'A', true),
      botClient(port, 'doudizhu', 'B', false),
      botClient(port, 'doudizhu', 'C', false),
    ]);
    ok(res.length === 3, '三个客户端都收到了对局结果');
    ok(res.every(function (r) { return r.seat >= 0; }), '每个客户端都分到了座位：' + res.map(function (r) { return r.name + '=' + r.seat; }).join(','));
    ok(res.every(function (r) { return r.result && r.result.text; }), '结果文案：' + (res[0].result && res[0].result.text));
  } finally {
    srv.close();
    await sleep(200);
  }
}

/* ---------------- main ---------------- */

async function main() {
  testRender();
  testParse();
  try {
    await testNet();
  } catch (e) {
    console.log('  \u2717 联网测试异常: ' + e.message);
    fails++;
  }
  console.log('');
  if (fails) { console.log(fails + ' 项失败'); process.exit(1); }
  console.log('冒烟测试全部通过。');
  process.exit(0);
}

main().catch(function (e) { console.error(e); process.exit(1); });
