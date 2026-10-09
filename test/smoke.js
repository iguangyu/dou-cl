'use strict';

/* 冒烟测试：渲染 / 输入解析 / 联网全流程（一端口一房间） */

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
function rnd() { return Math.floor(Math.random() * 500); }

/* ---------------- 1. 渲染 ---------------- */

function testRender() {
  console.log('\n[1] 渲染');
  gamesMod.keys.forEach(function (key) {
    const e = gamesMod.create(key);
    const st = e.start([
      { name: '你', bot: false }, { name: '小美', bot: true },
      { name: '阿飞', bot: true }, { name: '老王', bot: true },
    ]);
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

/* ---------------- 3. 联网 ---------------- */

/** 连上、报名、等 seated/full 就返回（不参与打牌）；期间收到的 notice 也记下来 */
function seatOnly(port, name) {
  return new Promise(function (resolve, reject) {
    const ws = new WebSocket('ws://127.0.0.1:' + port);
    const out = { ws: ws, notices: [] };
    const timer = setTimeout(function () {
      try { ws.close(); } catch (e) { /* ignore */ }
      reject(new Error(name + ' 超时'));
    }, 6000);
    ws.on('open', function () { ws.send(JSON.stringify({ t: 'join', name: name })); });
    ws.on('message', function (raw) {
      let m;
      try { m = JSON.parse(String(raw)); } catch (e) { return; }
      if (m.t === 'hello') return;
      if (m.t === 'notice') { out.notices.push(m.msg); return; }
      if (m.t === 'seated') { clearTimeout(timer); out.seat = m.seat; out.room = m.room; resolve(out); }
      if (m.t === 'full') { clearTimeout(timer); out.full = m.msg; resolve(out); }
    });
    ws.on('error', function (e) { clearTimeout(timer); reject(new Error(name + ' @' + port + ': ' + e.message)); });
  });
}

/** 会自己出牌的机器人客户端，打完整局后返回结果 */
function botClient(port, name, opts) {
  opts = opts || {};
  return new Promise(function (resolve, reject) {
    const ws = new WebSocket('ws://127.0.0.1:' + port);
    const log = { name: name, seat: -1, result: null, full: null, lobby: [] };
    const timer = setTimeout(function () {
      try { ws.close(); } catch (e) { /* ignore */ }
      reject(new Error(name + ' 超时'));
    }, 25000);

    ws.on('open', function () { ws.send(JSON.stringify({ t: 'join', name: name })); });

    ws.on('message', function (raw) {
      let m;
      try { m = JSON.parse(String(raw)); } catch (e) { return; }
      if (m.t === 'seated') log.seat = m.seat;
      if (m.t === 'lobby') log.lobby.push(m.room.humans);
      if (m.t === 'full') {
        log.full = m.msg;
        clearTimeout(timer);
        try { ws.close(); } catch (e) { /* ignore */ }
        resolve(log);
        return;
      }
      if (m.t === 'state') {
        const v = m.view;
        if (v.over) {
          log.result = v.result;
          clearTimeout(timer);
          try { ws.close(); } catch (e) { /* ignore */ }
          resolve(log);
          return;
        }
        if (v.turn !== log.seat) return;
        const action = v.phase === 'bid'
          ? { type: 'bid', score: opts.bidHigh ? 3 : 0 }
          : bot.hintFromView(v, log.seat);
        ws.send(JSON.stringify({ t: 'act', action: action }));
      }
    });
    ws.on('error', function (e) { clearTimeout(timer); reject(new Error(name + ' @' + port + ': ' + e.message)); });
  });
}

function mkServer(port, game, extra) {
  const o = { game: game, ports: [port], host: '127.0.0.1', quiet: true, botDelay: 1, turnTimeout: 8000 };
  Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
  return serverMod.createServers(o);
}

/* 3a. 三个人连同一个端口，自动开一局 */
async function testAutoStart() {
  console.log('\n[3] 联网 · 三个人进同一个地址，自动开局');
  const port = 21000 + rnd();
  const srv = mkServer(port, 'doudizhu');
  await sleep(400);
  try {
    const res = await Promise.all([
      botClient(port, 'A', { bidHigh: true }),
      botClient(port, 'B', {}),
      botClient(port, 'C', {}),
    ]);
    ok(res.length === 3, '三个客户端都收到了对局结果');
    ok(res.every(function (r) { return r.seat >= 0; }),
      '每个客户端都分到了座位：' + res.map(function (r) { return r.name + '=' + r.seat; }).join(','));
    ok(res.every(function (r) { return r.result && r.result.text; }),
      '结果文案：' + (res[0].result && res[0].result.text));
    ok(res.every(function (r) { return r.lobby[0] === r.seat + 1 || r.lobby[0] >= 1; }),
      '入座过程中收到过大厅人数：' + JSON.stringify(res.map(function (r) { return r.lobby; })));
  } finally {
    srv.close();
    await sleep(200);
  }
}

/* 3b. 人不够 → 等着；敲 start → 电脑补齐开局 */
async function testWaiting() {
  console.log('\n[4] 联网 · 人不够时等待，可随时补齐开局');
  const port = 26000 + rnd();
  const srv = mkServer(port, 'doudizhu');
  await sleep(400);
  const ws = new WebSocket('ws://127.0.0.1:' + port);
  try {
    let seat = -1;
    let humans = 0;
    let gotStateBeforeStart = false;

    await new Promise(function (resolve) {
      const t = setTimeout(resolve, 2000);
      ws.on('open', function () { ws.send(JSON.stringify({ t: 'join', name: '孤独' })); });
      ws.on('message', function (raw) {
        let m;
        try { m = JSON.parse(String(raw)); } catch (e) { return; }
        if (m.t === 'seated') seat = m.seat;
        if (m.t === 'lobby') { humans = m.room.humans; clearTimeout(t); resolve(); }
        if (m.t === 'state') gotStateBeforeStart = true;
      });
    });

    ok(seat === 0, '一个人也能坐下（座位 0）—— 服务器不占座位');
    ok(humans === 1, '大厅显示 1/' + 3 + ' 人，正在等（不会硬塞电脑）');

    await sleep(900);
    ok(!gotStateBeforeStart, '人不够时不会自动开局，一直在等');

    const started2 = await new Promise(function (resolve) {
      const t = setTimeout(function () { resolve(false); }, 8000);
      ws.on('message', function (raw) {
        let m;
        try { m = JSON.parse(String(raw)); } catch (e) { return; }
        if (m.t === 'state') { clearTimeout(t); resolve(true); }
      });
      ws.send(JSON.stringify({ t: 'start' }));
    });
    ok(started2, '敲 start 后不足的位置由电脑补上并开局');
  } finally {
    try { ws.close(); } catch (e) { /* ignore */ }
    srv.close();
    await sleep(200);
  }
}

/* 3c. 人满了 → 直接回绝 */
async function testFull() {
  console.log('\n[5] 联网 · 人满了就直接回绝');
  const port = 31000 + rnd();
  const srv = mkServer(port, 'doudizhu');
  await sleep(400);
  try {
    const a = await seatOnly(port, 'P1');
    const b = await seatOnly(port, 'P2');
    const c = await seatOnly(port, 'P3');
    ok(a.seat === 0 && b.seat === 1 && c.seat === 2, '前 3 个人依次坐进 0/1/2 号位');
    const d = await seatOnly(port, 'P4');
    ok(!!d.full, '第 4 个人被回绝：' + d.full);
    ok(/满|游戏中/.test(d.full || ''), '回绝文案说得清楚（满 / 游戏中）');
    [a, b, c, d].forEach(function (x) { try { x.ws.close(); } catch (e) { /* ignore */ } });
  } finally {
    srv.close();
    await sleep(200);
  }
}

/* 3d. 一次开一段端口，每个端口是独立房间 */
async function testMultiPort() {
  console.log('\n[6] 联网 · 一段端口 = 一串独立房间');
  const base = 36000 + rnd();
  const srv = serverMod.createServers({
    game: 'fivek', ports: [base, base + 1, base + 2],
    host: '127.0.0.1', quiet: true, botDelay: 1, turnTimeout: 8000,
  });
  await sleep(500);
  try {
    ok(srv.ports.length === 3, '一次起了 3 个房间（' + srv.ports.join(', ') + '）');
    const a = await seatOnly(base, 'X');
    const b = await seatOnly(base + 1, 'Y');
    const c = await seatOnly(base + 2, 'Z');
    ok(a.seat === 0 && b.seat === 0 && c.seat === 0,
      '三个端口各自是独立房间，都是 0 号位（互不影响）');
    ok(a.room.game === 'fivek' && a.room.seats === 4, '房间玩法/座位数由服务器决定（fivek · 4 人）');
    [a, b, c].forEach(function (x) { try { x.ws.close(); } catch (e) { /* ignore */ } });
  } finally {
    srv.close();
    await sleep(200);
  }
}

/* 3e. 有人走了，其他人立刻知道（断线 / Ctrl+C 都是这条路） */
async function testLeaveNotice() {
  console.log('\n[7] 联网 · 有人走了，其他人立刻知道');
  const port = 41000 + rnd();
  const srv = mkServer(port, 'doudizhu');
  await sleep(400);
  try {
    const a = await seatOnly(port, 'A');
    const b = await seatOnly(port, 'B');
    ok(a.seat === 0 && b.seat === 1, 'A、B 依次就座');
    a.ws.close();                         // 相当于 A 那边断了 / 按了 Ctrl+C
    await sleep(400);
    ok(b.notices.length > 0, 'B 收到了 A 离开的通知：' + (b.notices[0] || '（没收到）'));
    try { b.ws.close(); } catch (e) { /* ignore */ }
  } finally {
    srv.close();
    await sleep(200);
  }
}

/* 3f. 客户端：不是自己回合时，本地命令照样能用（回归：以前会被直接吞掉） */
async function testClientLocalCommands() {
  console.log('\n[8] 客户端 · 不是自己的回合也能换皮肤');
  const port = 46000 + rnd();
  const srv = mkServer(port, 'doudizhu');
  const skinBefore = ui.skinKey();
  await sleep(400);
  try {
    const io = {
      lines: [], handler: null, lastPrompt: '',
      say: function (t) { this.lines.push(String(t)); },
      block: function (t) { this.lines.push(String(t)); },
      clear: function () {},
      close: function () {},
      ask: function (p, h) { this.handler = h; this.lastPrompt = String(p); },
    };
    ui.setSkin('log');
    const client = require('../src/net/client');
    client.runClient(io, { server: '127.0.0.1:' + port, name: 'me' }, {});

    await sleep(400);
    ok(!!io.handler, '入座后正在等输入');
    if (io.handler) io.handler('s');            // 用电脑补齐开局
    await sleep(900);
    ok(!!io.handler, '开局后**仍然**在等输入（旧版本这里是 false，输入被吞）');

    if (io.handler) io.handler('skin hex');
    ok(ui.skinKey() === 'hex', '不是自己的回合，敲 skin hex 也立刻换皮肤（' + ui.skinKey() + '）');

    let threw = false;
    try { if (io.handler) io.handler('reveal'); } catch (e) { threw = true; }
    ok(!threw, 'reveal 也不报错');

    if (io.handler) io.handler('quit');         // 收尾：走出房间
    await sleep(200);
  } finally {
    ui.setSkin(skinBefore);
    srv.close();
    await sleep(200);
  }
}

/* ---------------- main ---------------- */

async function main() {
  testRender();
  testParse();
  const nets = [testAutoStart, testWaiting, testFull, testMultiPort, testLeaveNotice, testClientLocalCommands];
  for (let i = 0; i < nets.length; i++) {
    try {
      await nets[i]();
    } catch (e) {
      console.log('  \u2717 [' + (nets[i].name || ('#' + i)) + '] 异常: ' + e.message);
      fails++;
    }
  }
  console.log('');
  if (fails) { console.log(fails + ' 项失败'); process.exit(1); }
  console.log('冒烟测试全部通过。');
  process.exit(0);
}

main().catch(function (e) { console.error(e); process.exit(1); });
