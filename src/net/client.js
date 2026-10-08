'use strict';

const WebSocket = require('ws');
const ui = require('../ui');
const bot = require('../bot');
const gamesMod = require('../games');
const rulesMod = require('../core/rules');

const colors = ui.colors;

function hintAction(view, seat) {
  const act = bot.hintFromView(view, seat);
  if (act && act.type === 'play' && act.ids && act.ids.length) return act.ids;
  return null;
}

async function runClient(io, opts, argv) {
  const url = opts.server.indexOf('ws://') === 0 || opts.server.indexOf('wss://') === 0
    ? opts.server
    : 'ws://' + opts.server;

  io.say(colors.dim('连接中 ' + url + ' …'));

  const ws = new WebSocket(url);
  let mySeat = -1;
  let roomCode = opts.code || null;
  let lastView = null;
  let helpShown = false;

  function sendMsg(o) {
    if (ws.readyState === 1) ws.send(JSON.stringify(o));
  }

  function promptTurn(view) {
    const prompt = view.phase === 'bid'
      ? '\n叫分 (0=不叫 1/2/3=叫分, ?=帮助) > '
      : '\n出牌 (例: 34567 或 5 5 5 6 / p 不要 / h 提示 / ? 帮助) > ';
    io.ask(prompt, function (line) {
      handleInput(line, view);
    });
  }

  function handleInput(line, view) {
    const low = line.toLowerCase();
    if (!line) { promptTurn(view); return; }

    if (low === 'help' || low === '?' ) {
      printHelp(view.key);
      promptTurn(view);
      return;
    }
    if (low === 'quit' || low === 'exit' || low === 'leave') {
      sendMsg({ t: 'leave' });
      io.say('已离开房间。');
      ws.close();
      return;
    }
    if (view.phase === 'bid') {
      const v = parseInt(line, 10);
      if (isNaN(v) || v < 0 || v > 3) { io.say(colors.red('叫分只能是 0/1/2/3')); promptTurn(view); return; }
      sendMsg({ t: 'act', action: { type: 'bid', score: v } });
      return;
    }
    if (low === 'p' || low === 'pass' || line === '不要' || line === '过') {
      if (!view.canPass) { io.say(colors.red('你是先手，必须出牌')); promptTurn(view); return; }
      sendMsg({ t: 'act', action: { type: 'pass' } });
      return;
    }
    if (low === 'h' || low === 'hint' || line === '提示') {
      const ids = hintAction(view, mySeat);
      if (!ids || !ids.length) { io.say(colors.red('没有能管上的牌，只能不要。')); }
      else {
        const cards = view.hand.filter(function (c) { return ids.indexOf(c.id) >= 0; });
        io.say('提示: ' + ui.handText(cards));
        const combo = require('../core/combo');
        const co = combo.analyze(cards, rulesMod.get(view.key));
        if (co) io.say('      ' + combo.typeName(co.type));
      }
      promptTurn(view);
      return;
    }

    const parsed = ui.parseCardInput(line, view.hand);
    if (!parsed.ok) { io.say(colors.red(parsed.err)); promptTurn(view); return; }
    sendMsg({ t: 'act', action: { type: 'play', ids: parsed.ids } });
  }

  function printHelp(key) {
    const r = rulesMod.get(key);
    io.say('');
    io.say(colors.bold(' ' + r.name + ' 玩法') + colors.dim('  ' + r.tagline));
    r.help.forEach(function (h) { io.say('  ' + h); });
    io.say('');
    io.say(colors.bold(' 操作'));
    io.say('  出牌：直接输入点数，如 3 4 5 6 7，可写 34567；带花色写 5s 5h');
    io.say('        点数对照：3 4 5 6 7 8 9 0(10) J Q K A 2 w(小王) W(大王)');
    io.say('        p=不要   h=提示   ?=帮助   quit=离开');
    io.say('');
  }

  function renderState(view) {
    lastView = view;
    io.clear();
    process.stdout.write(ui.renderTable(view, mySeat, {}) + '\n');
    if (view.over) {
      askAgain();
      return;
    }
    if (view.turn === mySeat && view.phase !== 'over') {
      promptTurn(view);
    } else {
      io.handler = null;
      const who = view.seats[view.turn] ? view.seats[view.turn].name : '?';
      process.stdout.write(colors.dim(' 等待 ' + who + (view.phase === 'bid' ? ' 叫分…' : ' 出牌…')) + '\n');
    }
  }

  function askAgain() {
    io.ask('\n再来一局？(y/n) > ', function (line) {
      const yes = /^y/i.test(line.trim());
      sendMsg({ t: 'again', yes: yes });
      if (!yes) io.say(colors.dim('已发送。等房主决定后房间里会继续。'));
    });
  }

  function renderLobby(room) {
    io.clear();
    io.say('');
    io.say(colors.bold(' 房间 ' + room.code) + '  ' + colors.dim(room.gameName + ' · ' + room.seats + ' 人'));
    io.say(' ' + '\u2500'.repeat(50));
    const list = [];
    for (let i = 0; i < room.seats; i++) {
      const p = room.players[i];
      list.push('  ' + (i + 1) + '号位  ' + (p ? (p.bot ? colors.dim(p.name + '(电脑)') : p.name) : colors.dim('空')));
    }
    list.forEach(function (l) { io.say(l); });
    io.say(' ' + '\u2500'.repeat(50));
    io.say(colors.dim(' 把房间号发给朋友，或让他们执行： npx dou-cl --join <地址> --code ' + room.code));
    return list;
  }

  ws.on('open', function () {
    io.clear();
    io.say(colors.green('已连上服务器。'));
    if (opts.mode === 'match') {
      sendMsg({ t: 'match', game: opts.game, name: opts.name });
    } else if (opts.mode === 'join') {
      sendMsg({ t: 'join', code: opts.code, name: opts.name });
    } else {
      sendMsg({ t: 'create', game: opts.game, name: opts.name, public: false });
    }
  });

  ws.on('message', function (raw) {
    let m;
    try { m = JSON.parse(String(raw)); } catch (e) { return; }

    if (m.t === 'hello') {
      opts.games = m.games;
      return;
    }
    if (m.t === 'joined') {
      mySeat = m.seat;
      roomCode = m.code;
      io.say(colors.green('已进入房间 ' + m.code + '（座位 ' + (m.seat + 1) + '）'));
      return;
    }
    if (m.t === 'room' || m.t === 'lobby') {
      if (lastView && !lastView.over) return;
      renderLobby(m.room);
      const isHost = mySeat >= 0 && m.room.hostSeat === mySeat;
      if (isHost) {
        io.ask('\n' + colors.bold('按 Enter 开始游戏（不足的位置由电脑补上）> '), function (line) {
          const low = line.trim().toLowerCase();
          if (low === 'q' || low === 'quit') { sendMsg({ t: 'leave' }); ws.close(); return; }
          sendMsg({ t: 'start' });
        });
      } else {
        io.handler = null;
        io.say(colors.dim(' 等房主开始…（输入 quit 离开）'));
      }
      return;
    }
    if (m.t === 'state') {
      renderState(m.view);
      return;
    }
    if (m.t === 'notice') { io.say(colors.dim('· ' + m.msg)); return; }
    if (m.t === 'chat') { io.say(colors.cyan('[' + m.who + '] ') + m.msg); return; }
    if (m.t === 'error') {
      io.say(colors.red('! ' + m.msg));
      if (!mySeat && mySeat !== 0) {
        ws.close();
      } else if (lastView) {
        promptTurn(lastView);
      }
      return;
    }
  });

  ws.on('close', function () {
    io.say(colors.dim('与服务器的连接已断开。'));
    io.close();
  });

  ws.on('error', function (e) {
    io.say(colors.red('连接失败: ' + e.message));
    io.say(colors.dim('请确认地址/端口正确，且服务端已启动（npx dou-cl --serve）。'));
    io.close();
  });
}

module.exports = { runClient: runClient };
