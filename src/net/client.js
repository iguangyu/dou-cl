'use strict';

/*
 * 联网客户端 —— 连上一个地址就是进入那个房间。
 *
 *   npx dou-cl --join 192.168.1.10:8080
 *
 * 规则：**只有「出牌」需要服务器**。
 * 换皮肤 / reveal / redraw / 帮助 / 退出这些都是纯本地的，任何时刻都能用 ——
 * 哪怕是别人的回合、你正在等他们出牌。
 */

const WebSocket = require('ws');
const ui = require('../ui');
const bot = require('../bot');
const rulesMod = require('../core/rules');
const comboMod = require('../core/combo');
const skinsMod = require('../skins');

const colors = ui.colors;

/* ------------------------------------------------------------------ */

function hintIds(view, seat) {
  const act = bot.hintFromView(view, seat);
  if (act && act.type === 'play' && act.ids && act.ids.length) return act.ids;
  return null;
}

function asciiName(s, fallback) {
  return /^[\x20-\x7e]*$/.test(s || '') ? s : fallback;
}

function toUrl(s) {
  let v = String(s || '').trim();
  if (!v) v = '127.0.0.1:8080';
  if (v.indexOf('ws://') === 0 || v.indexOf('wss://') === 0) return v;
  if (v.indexOf(':') < 0) v += ':8080';
  return 'ws://' + v;
}

/* ------------------------------------------------------------------ */

async function runClient(io, opts) {
  const url = toUrl(opts.server);
  const addr = url.replace(/^wss?:\/\//, '');
  const skin0 = ui.skinActive();

  if (skin0) io.block(ui.skinMessage('connect svc=deck-sync addr=' + url));
  else io.say(colors.dim('连接中 ' + addr + ' …'));

  const ws = new WebSocket(url);
  let mySeat = -1;
  let lastView = null;
  let roomInfo = null;
  let gameKey = opts.game || 'doudizhu';
  let leaveSent = false;
  let sigHandler = null;

  function sendMsg(o) {
    if (ws.readyState === 1) ws.send(JSON.stringify(o));
  }

  /** 摸鱼模式下只输出 ASCII —— 有 en 就用 en，避免漏出中文 */
  function pick(msg, en) {
    return (ui.skinActive() && en) ? en : msg;
  }

  function notify(msg, en) {
    const body = pick(msg, en);
    const m = ui.skinMessage(body);
    if (m !== null) io.block(m);
    else io.say(colors.dim('· ' + body));
  }

  function complain(msg, en) {
    const body = pick(msg, en);
    if (ui.skinActive()) io.block(ui.skinMessage('! ' + body));
    else io.say(colors.red(body));
  }

  function quit() {
    if (leaveSent) return;
    leaveSent = true;
    sendMsg({ t: 'leave' });
    try { ws.close(); } catch (e) { /* ignore */ }
  }

  function isQuit(line) {
    const low = (line || '').trim().toLowerCase();
    return low === 'q' || low === 'quit' || low === 'exit' || low === 'leave';
  }

  /* ---- Ctrl+C：先说一声再走（别人 / 服务器立刻知道） ---- */

  sigHandler = function () {
    if (leaveSent) { process.exit(0); return; }
    leaveSent = true;
    sendMsg({ t: 'leave' });
    // 给 socket 一点时间把这句话送出去，再退出
    setTimeout(function () { process.exit(0); }, 150);
  };
  process.on('SIGINT', sigHandler);

  function dropSigint() {
    if (sigHandler) { process.removeListener('SIGINT', sigHandler); sigHandler = null; }
  }

  /* ---- 帮助 ---- */

  function printHelp(key) {
    const r = rulesMod.get(key || gameKey);
    const lines = [r.name + '   ' + r.tagline].concat(r.help || []);
    lines.push('');
    lines.push('出牌：34567 或 3 4 5 6 7 ；带花色 5s 5h 5c');
    lines.push('p=不要  h=提示  ?=帮助  q=离开');
    if (ui.skinActive()) {
      const s = ui.skinHelp(lines);
      if (s !== null) { process.stdout.write(s); return; }
    }
    io.say('');
    lines.forEach(function (l) { io.say('  ' + l); });
    io.say('');
  }

  /* ---- 纯本地命令：任何时刻都该能用 ---- */

  /** @returns true 表示这条输入已经被本地处理掉，不要当作出牌 */
  function localCommand(line, view) {
    const low = (line || '').trim().toLowerCase();
    const skin = ui.skinActive();

    if (skin) {
      if (low === 'reveal' || low === 'real') {
        process.stdout.write(ui.renderTable(view || lastView, mySeat, {}) + '\n');
        return true;
      }
      if (low === 'redraw' || low === 'rr') {
        if (view || lastView) io.block(ui.renderSkin(view || lastView, mySeat, {}));
        return true;
      }
      if (low.indexOf('skin') === 0) {
        const k = low.split(/\s+/)[1];
        if (!k) {
          notify('skins: ' + ui.skinList().map(function (s) { return s.key; }).join(' '),
            'skins: ' + ui.skinList().map(function (s) { return s.key; }).join(' '));
        } else {
          try { ui.setSkin(k); notify('skin -> ' + ui.skinKey(), 'skin -> ' + ui.skinKey()); }
          catch (e) { notify('no such skin: ' + k, 'no such skin: ' + k); }
        }
        return true;
      }
    }
    if (low === 'help' || low === '?' || low === 'rules') { printHelp(view && view.key); return true; }
    return false;
  }

  /* ---- 等待界面 ---- */

  function askWaiting() {
    const skin = ui.skinActive();
    const more = !roomInfo || roomInfo.humans < roomInfo.seats;
    const hint = more ? '[s] 用电脑补齐先开局   [q] 退出' : '[q] 退出';
    io.ask(skin ? ui.skinPrompt() : '\n' + colors.dim(hint) + ' > ', function (line) {
      const low = (line || '').trim().toLowerCase();
      if (isQuit(low)) { quit(); return; }
      if (low === 's' || low === 'start') { sendMsg({ t: 'start' }); return; }
      if (low === '?' || low === 'help') { printHelp(roomInfo && roomInfo.game); }
      askWaiting();
    });
  }

  function renderLobby(room) {
    roomInfo = room;
    gameKey = room.game;
    const skin = ui.skinActive();

    if (skin) {
      notify('room=' + addr + ' svc=deck-sync game=' + room.game +
        ' seats=' + room.seats + ' ready=' + room.humans + '/' + room.seats);
      const nodes = [];
      for (let i = 0; i < room.seats; i++) {
        const p = room.players[i];
        if (!p) nodes.push('slot' + i + '=empty');
        else if (p.bot) nodes.push('slot' + i + '=worker-' + i);
        else if (i === mySeat) nodes.push('slot' + i + '=self');
        else nodes.push('slot' + i + '=' + asciiName(p.name, 'peer' + i));
      }
      notify('nodes=[' + nodes.join(' ') + ']');
      if (room.humans < room.seats) notify('waiting for peers ... (s=fill workers, q=leave)');
      else notify('lobby ready, starting ...');
      askWaiting();
      return;
    }

    io.clear();
    io.say('');
    io.say(colors.bold(' 房间 ' + addr) + '   ' + colors.dim(room.gameName + ' · ' + room.seats + ' 人'));
    io.say(' ' + '\u2500'.repeat(52));
    for (let i = 0; i < room.seats; i++) {
      const p = room.players[i];
      let who;
      if (!p) who = colors.dim('空 · 等待加入');
      else if (p.bot) who = colors.dim(p.name + '（电脑）');
      else if (i === mySeat) who = colors.green(p.name + '（你）');
      else who = p.name;
      io.say('  ' + (i + 1) + ' 号位   ' + who);
    }
    io.say(' ' + '\u2500'.repeat(52));
    if (room.humans < room.seats) {
      io.say(colors.dim(' 等待玩家 ' + room.humans + '/' + room.seats +
        '    朋友加入： npx dou-cl --join ' + addr));
    } else {
      io.say(colors.dim(' 人齐了，马上开始…'));
    }
    askWaiting();
  }

  /* ---- 牌局 ---- */

  function promptTurn(view) {
    if (ui.skinActive()) {
      io.ask(ui.skinPrompt(), function (line) { onTurnInput(line, view); });
      return;
    }
    const prompt = view.phase === 'bid'
      ? '\n叫分 (0=不叫 1/2/3=叫分, ?=帮助) > '
      : '\n出牌 (例: 34567 或 5 5 5 6 / p 不要 / h 提示 / ? 帮助) > ';
    io.ask(prompt, function (line) { onTurnInput(line, view); });
  }

  /** 轮到我：本地命令优先，其余当作出牌 */
  function onTurnInput(line, view) {
    if (!line) { promptTurn(view); return; }
    if (isQuit(line)) { quit(); return; }
    if (localCommand(line, view)) { promptTurn(view); return; }
    playInput(line, view);
  }

  /** 不是我的回合：本地命令照样能用，想打牌就告诉他还没轮到你 */
  function askIdle(view) {
    const prompt = ui.skinActive() ? ui.skinPrompt()
      : '\n' + colors.dim('[q] 退出   本地命令随时可用： reveal / redraw / skin <名> / ?') + ' > ';
    io.ask(prompt, function (line) {
      if (isQuit(line)) { quit(); return; }
      if (localCommand(line, view)) { askIdle(view); return; }
      if ((line || '').trim()) {
        const hint = ui.skinActive()
          ? 'not your turn yet  (local: reveal / redraw / skin <name> / help)'
          : '还没轮到你。本地命令随时可用： reveal / redraw / skin <名> / ?';
        notify(hint, hint);
      }
      askIdle(view);
    });
  }

  function playInput(line, view) {
    const low = line.toLowerCase();
    const skin = ui.skinActive();

    if (view.phase === 'bid') {
      const v = parseInt(line, 10);
      if (isNaN(v) || v < 0 || v > 3) {
        complain('叫分只能是 0/1/2/3', 'bid must be 0 / 1 / 2 / 3');
        promptTurn(view);
        return;
      }
      sendMsg({ t: 'act', action: { type: 'bid', score: v } });
      return;
    }
    if (low === 'p' || low === 'pass' || line === '不要' || line === '过' || line === '不出') {
      if (!view.canPass) {
        complain('你是先手，必须出牌', 'you lead this round, must play');
        promptTurn(view);
        return;
      }
      sendMsg({ t: 'act', action: { type: 'pass' } });
      return;
    }
    if (low === 'h' || low === 'hint' || line === '提示') {
      const ids = hintIds(view, mySeat);
      if (!ids || !ids.length) {
        complain('没有能管上的牌，只能不要（pass）', 'nothing beats it, must pass');
      } else {
        const cards = view.hand.filter(function (c) { return ids.indexOf(c.id) >= 0; });
        const co = comboMod.analyze(cards, rulesMod.get(view.key));
        if (skin) {
          const txt = 'hint ' + cards.map(function (c) { return skinsMod.packet.cardCode(c); }).join(' ') +
            '  [' + (co ? co.type : '') + ']';
          io.block(ui.skinMessage(txt));
        } else {
          io.say('hint: ' + ui.handText(cards) + '  [' + (co ? comboMod.typeName(co.type) : '') + ']');
        }
      }
      promptTurn(view);
      return;
    }

    const parsed = ui.parseCardInput(line, view.hand);
    if (!parsed.ok) { complain(parsed.err, parsed.en); promptTurn(view); return; }
    sendMsg({ t: 'act', action: { type: 'play', ids: parsed.ids } });
  }

  function renderState(view) {
    lastView = view;
    const skin = ui.skinActive();
    const skinned = ui.renderSkin(view, mySeat, {});
    if (skinned !== null) io.block(skinned);
    else { io.clear(); process.stdout.write(ui.renderTable(view, mySeat, {}) + '\n'); }

    if (view.over) {
      const txt = (view.result && view.result.text) || '';
      if (skin) notify('round done  next round soon (q=leave)', 'round done  next round soon (q=leave)');
      else io.say(colors.dim(' 本局结束，马上开始下一局…（q 退出）'));
      askIdle(view);
      return;
    }
    if (view.turn === mySeat && view.phase !== 'over') {
      promptTurn(view);
    } else {
      const who = view.seats[view.turn] ? view.seats[view.turn].name : '?';
      if (skin) notify('waiting for ' + asciiName(who, 'peer') + ' ...',
        'waiting for ' + asciiName(who, 'peer') + ' ...');
      else process.stdout.write(colors.dim(' 等待 ' + who + (view.phase === 'bid' ? ' 叫分…' : ' 出牌…')) + '\n');
      askIdle(view);
    }
  }

  /* ---- 连接 ---- */

  ws.on('open', function () {
    if (!ui.skinActive()) { io.clear(); io.say(colors.green('已连上 ' + addr + '，正在进入房间…')); }
    sendMsg({ t: 'join', name: opts.name });
  });

  ws.on('message', function (raw) {
    let m;
    try { m = JSON.parse(String(raw)); } catch (e) { return; }

    if (m.t === 'hello') { gameKey = m.game; return; }

    if (m.t === 'seated') {
      mySeat = m.seat;
      if (ui.skinActive()) notify('seated room=' + addr + ' slot=' + m.seat + ' game=' + gameKey);
      return;
    }

    if (m.t === 'lobby') {
      if (lastView && lastView.over) lastView = null;
      if (m.room.started) return;   // 已经开局了，等 state
      renderLobby(m.room);
      return;
    }

    if (m.t === 'state') { renderState(m.view); return; }
    if (m.t === 'notice') { notify(m.msg, m.en); return; }

    if (m.t === 'chat') {
      if (ui.skinActive()) notify(m.who + ': ' + m.msg);
      else io.say(colors.cyan('[' + m.who + '] ') + m.msg);
      return;
    }

    if (m.t === 'full') {
      complain(m.msg, m.en);
      if (!ui.skinActive()) {
        io.say(colors.dim(' 换一个端口，或稍后再来（房间空了就能进）。'));
      }
      setTimeout(function () { try { ws.close(); } catch (e) { /* ignore */ } }, 150);
      return;
    }

    if (m.t === 'error') {
      complain(m.msg, m.en);
      if (mySeat < 0) setTimeout(function () { try { ws.close(); } catch (e) { /* ignore */ } }, 150);
      else if (lastView && !lastView.over) promptTurn(lastView);
      return;
    }
  });

  ws.on('close', function () {
    dropSigint();
    if (!ui.skinActive()) io.say(colors.dim('与服务器的连接已断开。'));
    io.close();
  });

  ws.on('error', function (e) {
    dropSigint();
    if (!ui.skinActive()) {
      io.say(colors.red('连接失败: ' + e.message));
      io.say(colors.dim('确认地址/端口正确，且那边已经开了房间（npx dou-cl --serve --port ' +
        (addr.split(':')[1] || '8080') + '）。'));
    } else {
      io.block(ui.skinMessage('! connect failed: ' + e.message));
    }
    io.close();
  });
}

module.exports = { runClient: runClient, toUrl: toUrl };
