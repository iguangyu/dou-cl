'use strict';

const WebSocket = require('ws');
const ui = require('../ui');
const bot = require('../bot');
const gamesMod = require('../games');
const rulesMod = require('../core/rules');

const colors = ui.colors;

function hintIds(view, seat) {
  const act = bot.hintFromView(view, seat);
  if (act && act.type === 'play' && act.ids && act.ids.length) return act.ids;
  return null;
}

function asciiName(s, fallback) {
  return /^[\x20-\x7e]*$/.test(s || '') ? s : fallback;
}

async function runClient(io, opts) {
  const url = (opts.server.indexOf('ws://') === 0 || opts.server.indexOf('wss://') === 0)
    ? opts.server
    : 'ws://' + opts.server;

  const skin0 = ui.skinActive();
  if (!skin0) io.say(colors.dim('连接中 ' + url + ' …'));
  else io.block(ui.skinMessage('connect svc=deck-sync addr=' + url));

  const ws = new WebSocket(url);
  let mySeat = -1;
  let lastView = null;

  function sendMsg(o) {
    if (ws.readyState === 1) ws.send(JSON.stringify(o));
  }

  function notify(text) {
    const m = ui.skinMessage(text);
    if (m !== null) io.block(m);
    else io.say(colors.dim('· ' + text));
  }

  function complain(msg) {
    if (ui.skinActive()) io.block(ui.skinMessage(msg));
    else io.say(colors.red(msg));
  }

  function promptTurn(view) {
    if (ui.skinActive()) {
      io.ask(ui.skinPrompt(), function (line) { handleInput(line, view); });
      return;
    }
    const prompt = view.phase === 'bid'
      ? '\n叫分 (0=不叫 1/2/3=叫分, ?=帮助) > '
      : '\n出牌 (例: 34567 或 5 5 5 6 / p 不要 / h 提示 / ? 帮助) > ';
    io.ask(prompt, function (line) { handleInput(line, view); });
  }

  function handleInput(line, view) {
    const low = line.toLowerCase();
    const skin = ui.skinActive();
    if (!line) { promptTurn(view); return; }

    if (skin) {
      if (low === 'reveal' || low === 'real') {
        process.stdout.write(ui.renderTable(view, mySeat, {}) + '\n');
        promptTurn(view);
        return;
      }
      if (low === 'redraw' || low === 'rr') {
        io.block(ui.renderSkin(view, mySeat, {}));
        promptTurn(view);
        return;
      }
      if (low.indexOf('skin') === 0) {
        const k = low.split(/\s+/)[1];
        if (!k) {
          ui.skinList().forEach(function (s) { notify(s.key + '  — ' + s.desc); });
        } else {
          try { ui.setSkin(k); notify('skin -> ' + ui.skinKey()); }
          catch (e) { notify(e.message); }
        }
        promptTurn(view);
        return;
      }
    }

    if (low === 'help' || low === '?' || low === 'rules') { printHelp(view.key); promptTurn(view); return; }
    if (low === 'quit' || low === 'exit' || low === 'leave') {
      sendMsg({ t: 'leave' });
      if (!skin) io.say('已离开房间。');
      ws.close();
      return;
    }
    if (view.phase === 'bid') {
      const v = parseInt(line, 10);
      if (isNaN(v) || v < 0 || v > 3) { complain('叫分只能是 0/1/2/3'); promptTurn(view); return; }
      sendMsg({ t: 'act', action: { type: 'bid', score: v } });
      return;
    }
    if (low === 'p' || low === 'pass' || line === '不要' || line === '过') {
      if (!view.canPass) { complain('你是先手，必须出牌'); promptTurn(view); return; }
      sendMsg({ t: 'act', action: { type: 'pass' } });
      return;
    }
    if (low === 'h' || low === 'hint' || line === '提示') {
      const ids = hintIds(view, mySeat);
      if (!ids || !ids.length) {
        complain('没有能管上的牌，只能不要（pass）');
      } else {
        const cards = view.hand.filter(function (c) { return ids.indexOf(c.id) >= 0; });
        const combo = require('../core/combo');
        const co = combo.analyze(cards, rulesMod.get(view.key));
        const txt = 'hint: ' + ui.handText(cards) + '  [' + (co ? combo.typeName(co.type) : '') + ']';
        if (skin) io.block(ui.skinMessage(txt)); else io.say(txt);
      }
      promptTurn(view);
      return;
    }

    const parsed = ui.parseCardInput(line, view.hand);
    if (!parsed.ok) { complain(parsed.err); promptTurn(view); return; }
    sendMsg({ t: 'act', action: { type: 'play', ids: parsed.ids } });
  }

  function printHelp(key) {
    const r = rulesMod.get(key);
    const lines = [r.name + '   ' + r.tagline].concat(r.help);
    lines.push('');
    lines.push('出牌：34567 或 3 4 5 6 7 ；带花色 5s 5h 5c');
    lines.push('p=不要  h=提示  ?=帮助  quit=离开');
    if (ui.skinActive()) {
      const s = ui.skinHelp(lines);
      if (s !== null) { process.stdout.write(s); return; }
    }
    io.say('');
    lines.forEach(function (l) { io.say('  ' + l); });
    io.say('');
  }

  function renderState(view) {
    lastView = view;
    const skin = ui.skinActive();
    const skinned = ui.renderSkin(view, mySeat, {});
    if (skinned !== null) {
      io.block(skinned);
    } else {
      io.clear();
      process.stdout.write(ui.renderTable(view, mySeat, {}) + '\n');
    }
    if (view.over) { askAgain(); return; }
    if (view.turn === mySeat && view.phase !== 'over') {
      promptTurn(view);
    } else {
      io.handler = null;
      const who = view.seats[view.turn] ? view.seats[view.turn].name : '?';
      if (skin) io.block(ui.skinMessage('waiting for ' + asciiName(who, 'peer') + ' ...'));
      else process.stdout.write(colors.dim(' 等待 ' + who + (view.phase === 'bid' ? ' 叫分…' : ' 出牌…')) + '\n');
    }
  }

  function askAgain() {
    io.ask(ui.skinActive() ? ui.skinPrompt() : '\n再来一局？(y/n) > ', function (line) {
      sendMsg({ t: 'again', yes: /^y/i.test(line.trim()) });
    });
  }

  function renderLobby(room) {
    if (ui.skinActive()) {
      notify('pool=' + room.code + ' svc=deck-sync game=' + room.game + ' seats=' + room.seats);
      const nodes = [];
      for (let i = 0; i < room.seats; i++) {
        const p = room.players[i];
        if (!p) nodes.push('slot' + i + '=empty');
        else if (p.bot) nodes.push('slot' + i + '=worker-' + i);
        else nodes.push('slot' + i + '=' + asciiName(p.name, i === room.hostSeat ? 'self' : ('peer' + i)));
      }
      notify('nodes=[' + nodes.join(' ') + ']');
      return;
    }
    io.clear();
    io.say('');
    io.say(colors.bold(' 房间 ' + room.code) + '  ' + colors.dim(room.gameName + ' · ' + room.seats + ' 人'));
    io.say(' ' + '\u2500'.repeat(50));
    for (let i = 0; i < room.seats; i++) {
      const p = room.players[i];
      io.say('  ' + (i + 1) + '号位  ' + (p ? (p.bot ? colors.dim(p.name + '(电脑)') : p.name) : colors.dim('空')));
    }
    io.say(' ' + '\u2500'.repeat(50));
    io.say(colors.dim(' 把房间号发给朋友，或让他们执行： npx dou-cl --join <地址> --code ' + room.code));
  }

  ws.on('open', function () {
    if (!ui.skinActive()) { io.clear(); io.say(colors.green('已连上服务器。')); }
    if (opts.mode === 'match') sendMsg({ t: 'match', game: opts.game, name: opts.name });
    else if (opts.mode === 'join') sendMsg({ t: 'join', code: opts.code, name: opts.name });
    else sendMsg({ t: 'create', game: opts.game, name: opts.name, public: false });
  });

  ws.on('message', function (raw) {
    let m;
    try { m = JSON.parse(String(raw)); } catch (e) { return; }

    if (m.t === 'hello') { opts.games = m.games; return; }

    if (m.t === 'joined') {
      mySeat = m.seat;
      notify('joined pool=' + m.code + ' slot=' + m.seat);
      return;
    }

    if (m.t === 'room' || m.t === 'lobby') {
      if (lastView && !lastView.over) return;
      renderLobby(m.room);
      const isHost = mySeat >= 0 && m.room.hostSeat === mySeat;
      if (isHost) {
        io.ask(ui.skinActive() ? ui.skinPrompt()
          : '\n' + colors.bold('按 Enter 开始游戏（不足的位置由电脑补上）> '),
        function (line) {
          const low = line.trim().toLowerCase();
          if (low === 'q' || low === 'quit') { sendMsg({ t: 'leave' }); ws.close(); return; }
          sendMsg({ t: 'start' });
        });
      } else {
        io.handler = null;
        if (ui.skinActive()) io.block(ui.skinMessage('waiting for host ...'));
        else io.say(colors.dim(' 等房主开始…（输入 quit 离开）'));
      }
      return;
    }

    if (m.t === 'state') { renderState(m.view); return; }
    if (m.t === 'notice') { notify(m.msg); return; }
    if (m.t === 'chat') {
      if (ui.skinActive()) notify(m.who + ': ' + m.msg);
      else io.say(colors.cyan('[' + m.who + '] ') + m.msg);
      return;
    }
    if (m.t === 'error') {
      complain(m.msg.indexOf('!') === 0 ? m.msg : ('! ' + m.msg));
      if (mySeat < 0) ws.close();
      else if (lastView) promptTurn(lastView);
      return;
    }
  });

  ws.on('close', function () {
    if (!ui.skinActive()) io.say(colors.dim('与服务器的连接已断开。'));
    io.close();
  });

  ws.on('error', function (e) {
    if (!ui.skinActive()) {
      io.say(colors.red('连接失败: ' + e.message));
      io.say(colors.dim('请确认地址/端口正确，且服务端已启动（npx dou-cl --serve）。'));
    }
    io.close();
  });
}

module.exports = { runClient: runClient };
