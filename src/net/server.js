'use strict';

/*
 * 联网服务端 —— **一个端口就是一个房间**。
 *
 *   npx dou-cl --serve --port 8080 -g doudizhu
 *
 * 服务器自己不占座位，只是托管这个房间：谁连上 127.0.0.1:8080 就坐进来。
 *   · 人满  → 回一句 full，客户端打印提示即可
 *   · 人不够 → 等着（可以一直等），玩家随时能退出，也能敲一下用电脑补齐先开局
 *   · 人够了 → 自动开局
 *
 * 想一口气开一片房间（公网场景）：--ports 10000-12000，每个端口一个房间。
 */

const WebSocket = require('ws');
const gamesMod = require('../games');
const rulesMod = require('../core/rules');
const bot = require('../bot');
const runner = require('../runner');

const sleep = runner.sleep;

/** 一局打完，留多久让大家看清结果再回大厅 */
const RESULT_HOLD_MS = 4000;
/** 人够了以后，等这么久再自动开局（给人一点反应时间） */
const AUTO_START_DELAY_MS = 1200;

function send(ws, obj) {
  if (ws && ws.readyState === 1) {
    try { ws.send(JSON.stringify(obj)); } catch (e) { /* ignore */ }
  }
}

/* ------------------------------------------------------------------ */
/* 房间                                                                */
/* ------------------------------------------------------------------ */

class Room {
  constructor(gameKey, opts) {
    opts = opts || {};
    this.gameKey = gameKey;
    this.rules = rulesMod.get(gameKey);
    this.seatCount = this.rules.seats;
    this.members = new Array(this.seatCount).fill(null); // 下标即座位号
    this.started = false;   // 正在打
    this.cooling = false;   // 刚打完，正在展示结果
    this.state = null;
    this.engine = null;
    this.botDelay = opts.botDelay || 800;
    this.turnTimeout = opts.turnTimeout || 90000;
    this.startTimer = null;
  }

  humans() {
    let n = 0;
    for (let i = 0; i < this.seatCount; i++) if (this.members[i] && !this.members[i].bot) n++;
    return n;
  }

  occupied() {
    let n = 0;
    for (let i = 0; i < this.seatCount; i++) if (this.members[i]) n++;
    return n;
  }

  freeSeat() {
    for (let i = 0; i < this.seatCount; i++) if (!this.members[i]) return i;
    return -1;
  }

  info() {
    const players = [];
    for (let i = 0; i < this.seatCount; i++) {
      const m = this.members[i];
      players.push(m ? { name: m.name, bot: !!m.bot } : null);
    }
    return {
      game: this.gameKey,
      gameName: this.rules.name,
      tagline: this.rules.tagline,
      seats: this.seatCount,
      humans: this.humans(),
      occupied: this.occupied(),
      started: this.started,
      players: players,
    };
  }
}

/* ------------------------------------------------------------------ */
/* 单个端口的房间服务                                                   */
/* ------------------------------------------------------------------ */

function startRoomServer(port, gameKey, opts, hooks) {
  const room = new Room(gameKey, opts);
  const wss = new WebSocket.Server({ port: port, host: opts.host || '0.0.0.0' });
  hooks.servers.push(wss);

  /* ---- 广播 ---- */

  function broadcast(msg) {
    room.members.forEach(function (m) { if (m) send(m.ws, msg); });
  }

  function broadcastLobby() {
    broadcast({ t: 'lobby', room: room.info() });
  }

  function broadcastState() {
    if (!room.state || !room.engine) return;
    room.members.forEach(function (m, i) {
      if (!m) return;
      send(m.ws, { t: 'state', view: room.engine.view(room.state, i), room: room.info() });
    });
  }

  /* ---- 谁该出牌 ---- */

  function makeDecider() {
    return function (state, seat) {
      const m = room.members[seat];
      if (!m || m.bot || !m.ws || m.ws.readyState !== 1) {
        return sleep(room.botDelay).then(function () {
          return bot.chooseAction(room.engine, state, seat);
        });
      }
      return new Promise(function (resolve) {
        let done = false;
        const finish = function (action) {
          if (done) return;
          done = true;
          m.pending = null;
          m.lastState = null;
          clearTimeout(m.timer);
          m.timer = null;
          resolve(action);
        };
        m.pending = finish;
        m.lastState = state;
        m.timer = setTimeout(function () {
          if (m.pending === finish) {
            send(m.ws, { t: 'notice', msg: '超时，已自动帮你出牌', en: 'timeout, auto-played for you' });
            finish(bot.chooseAction(room.engine, state, seat));
          }
        }, room.turnTimeout);
      });
    };
  }

  /* ---- 打一局 ---- */

  async function playOneRound() {
    const engine = gamesMod.create(room.gameKey);
    room.engine = engine;
    const players = room.members.map(function (m, i) {
      return { name: m ? m.name : ('电脑' + (i + 1)), bot: m ? !!m.bot : true };
    });
    const decider = makeDecider();

    let state;
    let tries = 0;
    do {
      state = await runner.runDeal(engine, players, decider,
        function (st) { room.state = st; broadcastState(); }, {});
      tries++;
    } while (state.result && state.result.type === 'redeal' && tries < 5);

    room.state = state;
    broadcastState();
    return state;
  }

  async function runRoom() {
    if (room.started || room.cooling) return;
    room.started = true;
    clearTimeout(room.startTimer);
    room.startTimer = null;
    try {
      await playOneRound();
    } catch (e) {
      hooks.log('端口 ' + port + ' 的房间出错: ' + (e && e.message));
    }
    room.started = false;
    room.state = null;
    room.engine = null;

    // 先把结果留在屏幕上，再回大厅
    room.cooling = true;
    setTimeout(function () {
      room.cooling = false;
      for (let i = 0; i < room.seatCount; i++) {
        const m = room.members[i];
        if (m && (m.bot || m.gone)) room.members[i] = null;
      }
      broadcastLobby();
      maybeStart(2500);
    }, RESULT_HOLD_MS);
  }

  function maybeStart(delay) {
    if (room.started || room.cooling) return;
    if (room.humans() <= 0 || room.humans() < room.seatCount) return;
    clearTimeout(room.startTimer);
    room.startTimer = setTimeout(function () {
      room.startTimer = null;
      if (room.started || room.cooling) return;
      if (room.humans() <= 0 || room.humans() < room.seatCount) return;
      runRoom();
    }, delay || 0);
  }

  function seatOf(ws) {
    for (let i = 0; i < room.seatCount; i++) {
      if (room.members[i] && room.members[i].ws === ws) return i;
    }
    return -1;
  }

  /* ---- 入座 / 离开 ---- */

  function onJoin(ws, name) {
    if (ws.seat !== undefined && ws.seat >= 0 && room.members[ws.seat] && room.members[ws.seat].ws === ws) {
      return send(ws, { t: 'seated', seat: ws.seat, room: room.info() });
    }
    if (room.started || room.cooling) {
      return send(ws, {
        t: 'full',
        msg: '房间正在游戏中（' + room.seatCount + '/' + room.seatCount + ' 人），稍后再试',
        en: 'game in progress, try again later',
      });
    }
    const seat = room.freeSeat();
    if (seat < 0) {
      return send(ws, { t: 'full', msg: '房间已满（' + room.seatCount + '/' + room.seatCount + ' 人）', en: 'room full' });
    }
    const clean = String(name || '').trim().slice(0, 12) || ('玩家' + (seat + 1));
    room.members[seat] = { name: clean, bot: false, ws: ws, pending: null, gone: false };
    ws.seat = seat;
    send(ws, { t: 'seated', seat: seat, room: room.info() });
    hooks.log(clean + ' 进入房间（端口 ' + port + '，座位 ' + seat + '）');
    broadcastLobby();
    maybeStart(AUTO_START_DELAY_MS);
  }

  function onStart(ws) {
    const seat = seatOf(ws);
    if (seat < 0) return send(ws, { t: 'error', msg: '你还没有入座', en: 'not seated' });
    if (room.started || room.cooling) return;
    const who = room.members[seat].name;
    broadcast({ t: 'notice', msg: who + ' 发起开局，不足的位置由电脑补上', en: 'start called, bots fill the empty seats' });
    runRoom();
  }

  function onLeave(ws) {
    const seat = seatOf(ws);
    if (seat < 0) return;
    const m = room.members[seat];

    if (room.started) {
      // 打牌中途走了 → 电脑接管这个座位，牌局继续
      if (m.pending) {
        const finish = m.pending;
        m.pending = null;
        clearTimeout(m.timer);
        m.timer = null;
        finish(bot.chooseAction(room.engine, m.lastState, seat));
      }
      m.bot = true;
      m.gone = true;
      m.ws = null;
      m.name = m.name + '(托管)';
      broadcast({ t: 'notice', msg: m.name + ' 断线，由电脑托管', en: 'a player left, autopilot on' });
      hooks.log(m.name + ' 断线（端口 ' + port + '），由电脑托管');
      return;
    }

    clearTimeout(room.startTimer);
    room.startTimer = null;
    room.members[seat] = null;
    ws.seat = -1;
    hooks.log((m && m.name ? m.name : '玩家') + ' 离开房间（端口 ' + port + '）');
    broadcastLobby();
    broadcast({ t: 'notice', msg: (m && m.name ? m.name : '玩家') + ' 离开了房间', en: 'a player left the room' });
  }

  /* ---- 连接 ---- */

  wss.on('connection', function (ws) {
    ws.isAlive = true;
    ws.seat = -1;
    ws.on('pong', function () { ws.isAlive = true; });

    send(ws, {
      t: 'hello',
      port: port,
      game: room.gameKey,
      gameName: room.rules.name,
      tagline: room.rules.tagline,
      seats: room.seatCount,
    });

    ws.on('message', function (raw) {
      let m;
      try { m = JSON.parse(String(raw)); }
      catch (e) { return send(ws, { t: 'error', msg: '消息格式错误', en: 'bad message' }); }

      if (m.t === 'join') return onJoin(ws, m.name);
      if (m.t === 'start') return onStart(ws);
      if (m.t === 'leave') return onLeave(ws);

      const seat = seatOf(ws);
      if (seat < 0) return send(ws, { t: 'error', msg: '你还没有入座', en: 'not seated' });

      if (m.t === 'act') {
        const mm = room.members[seat];
        if (!mm || !mm.pending) return send(ws, { t: 'error', msg: '现在不该你操作', en: 'not your turn' });
        const finish = mm.pending;
        mm.pending = null;
        return finish(m.action);
      }

      if (m.t === 'chat') {
        const who = (room.members[seat] && room.members[seat].name) || '玩家';
        broadcast({ t: 'chat', who: who, msg: String(m.msg).slice(0, 200) });
        return;
      }
    });

    ws.on('close', function () { onLeave(ws); });
    ws.on('error', function () { /* ignore，交给 close */ });
  });

  wss.on('error', function (e) {
    hooks.log('端口 ' + port + ' 启动失败: ' + e.message);
  });

  return {
    port: port,
    room: room,
    wss: wss,
    close: function () { try { wss.close(); } catch (e) { /* ignore */ } },
  };
}

/* ------------------------------------------------------------------ */
/* 对外                                                                */
/* ------------------------------------------------------------------ */

function createServers(opts) {
  opts = opts || {};
  const ports = (opts.ports && opts.ports.length) ? opts.ports.slice()
    : [opts.port || 8080];
  const gameKey = opts.game || 'doudizhu';
  if (!rulesMod.get(gameKey)) throw new Error('未知玩法：' + gameKey);

  const log = opts.quiet ? function () {} : function (s) { console.log('[dou-cl] ' + s); };
  const hooks = { servers: [], log: log };

  const list = [];
  for (let i = 0; i < ports.length; i++) {
    list.push(startRoomServer(ports[i], gameKey, opts, hooks));
  }

  // 所有房间共用一条心跳
  const heartbeat = setInterval(function () {
    hooks.servers.forEach(function (wss) {
      wss.clients.forEach(function (ws) {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        try { ws.ping(); } catch (e) { /* ignore */ }
      });
    });
  }, 30000);

  const rules = rulesMod.get(gameKey);
  if (ports.length === 1) {
    log(rules.name + ' 房间已开  端口 ' + ports[0]);
    log('别人连进来： npx dou-cl --join <本机IP>:' + ports[0]);
  } else {
    log(rules.name + ' 房间 × ' + ports.length + '  端口 ' + ports[0] + '-' + ports[ports.length - 1]);
    log('别人连进来： npx dou-cl --join <本机IP>:<端口>（每个端口一个独立房间）');
  }

  return {
    ports: ports,
    game: gameKey,
    rules: rules,
    servers: list,
    close: function () {
      clearInterval(heartbeat);
      list.forEach(function (s) { s.close(); });
    },
  };
}

module.exports = {
  createServers: createServers,
  createServer: createServers,   // 兼容旧调用：opts.port 走单端口
  Room: Room,
};
