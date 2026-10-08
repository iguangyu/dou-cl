'use strict';

const WebSocket = require('ws');
const gamesMod = require('../games');
const rulesMod = require('../core/rules');
const bot = require('../bot');
const runner = require('../runner');

const sleep = runner.sleep;

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

function send(ws, obj) {
  if (ws && ws.readyState === 1) {
    try { ws.send(JSON.stringify(obj)); } catch (e) { /* ignore */ }
  }
}

class Room {
  constructor(key, opts) {
    this.code = makeCode();
    this.gameKey = key;
    this.rules = rulesMod.get(key);
    this.seatCount = this.rules.seats;
    this.members = [];        // 下标即座位号
    this.spectators = [];
    this.hostId = null;
    this.public = !!(opts && opts.public);
    this.started = false;
    this.state = null;
    this.engine = null;
    this.botDelay = (opts && opts.botDelay) || 800;
    this.turnTimeout = (opts && opts.turnTimeout) || 90000;
    this.autoStartTimer = null;
    this.matchCountdown = (opts && opts.matchSeconds) || 12;
  }

  info() {
    const self = this;
    const players = [];
    let filled = 0, total = 0;
    for (let i = 0; i < this.seatCount; i++) {
      const m = this.members[i];
      if (m && !m.bot) filled++;
      if (m) total++;
      players.push(m ? { name: m.name, bot: !!m.bot } : null);
    }
    return {
      code: this.code,
      game: this.gameKey,
      gameName: this.rules.name,
      seats: this.seatCount,
      filled: filled,
      total: total,
      started: this.started,
      public: this.public,
      hostSeat: this.members.findIndex(function (m) { return m && m.id === self.hostId; }),
      players: players,
    };
  }

  freeSeat() {
    for (let i = 0; i < this.seatCount; i++) if (!this.members[i]) return i;
    return -1;
  }
}

function createServer(opts) {
  opts = opts || {};
  const port = opts.port || 8080;
  const host = opts.host || '0.0.0.0';
  const rooms = new Map();
  const wss = new WebSocket.Server({ port: port, host: host });

  function log(s) { if (!opts.quiet) console.log('[dou-cl] ' + s); }

  function broadcastRoomInfo(room) {
    const info = room.info();
    room.members.forEach(function (m) { if (m) send(m.ws, { t: 'room', room: info, youName: m.name }); });
    room.spectators.forEach(function (s) { send(s.ws, { t: 'room', room: info }); });
  }

  function broadcastState(room) {
    if (!room.state || !room.engine) return;
    room.members.forEach(function (m, i) {
      if (!m) return;
      send(m.ws, {
        t: 'state',
        view: room.engine.view(room.state, i),
        room: room.info(),
      });
    });
    room.spectators.forEach(function (s) {
      send(s.ws, { t: 'state', view: room.engine.view(room.state, -1), room: room.info() });
    });
  }

  function makeDecider(room) {
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
          clearTimeout(m.timer);
          m.timer = null;
          resolve(action);
        };
        m.pending = finish;
        m.timer = setTimeout(function () {
          if (m.pending === finish) {
            send(m.ws, { t: 'notice', msg: '超时，已自动帮你出牌' });
            finish(bot.chooseAction(room.engine, state, seat));
          }
        }, room.turnTimeout);
      });
    };
  }

  async function runRoom(room) {
    room.started = true;
    const engine = gamesMod.create(room.gameKey);
    room.engine = engine;
    const players = [];
    for (let i = 0; i < room.seatCount; i++) {
      const m = room.members[i];
      players.push({ name: m ? m.name : ('电脑' + (i + 1)), bot: m ? !!m.bot : true });
    }
    const decider = makeDecider(room);

    broadcastRoomInfo(room);
    for (let round = 0; round < 200; round++) {
      let state;
      let tries = 0;
      do {
        state = await runner.runDeal(engine, players, decider,
          function (st) { room.state = st; broadcastState(room); },
          {});
        tries++;
      } while (state.result && state.result.type === 'redeal' && tries < 5);

      room.state = state;
      broadcastState(room);

      // 等房主决定是否再来一局
      const host = room.members.find(function (m) { return m && m.id === room.hostId && !m.bot; });
      if (!host || host.ws.readyState !== 1) break;
      const again = await new Promise(function (resolve) {
        let done = false;
        const finish = function (v) {
          if (done) return;
          done = true;
          host.pendingAgain = null;
          clearTimeout(host.timerAgain);
          resolve(v);
        };
        host.pendingAgain = finish;
        host.timerAgain = setTimeout(function () { finish(false); }, 120000);
      });
      if (!again) break;
    }
    room.started = false;
    room.state = null;
    broadcastRoomInfo(room);
    room.members.forEach(function (m) { if (m && !m.bot) send(m.ws, { t: 'lobby', room: room.info() }); });
    // 清掉机器人和已断线的人，从大厅重新开始
    for (let i = 0; i < room.seatCount; i++) {
      const m = room.members[i];
      if (m && m.bot) room.members[i] = null;
    }
    if (!room.members.some(Boolean) && !room.spectators.length) rooms.delete(room.code);
  }

  function startRoom(room) {
    if (room.started) return;
    if (room.busy) return;
    room.busy = true;
    runRoom(room).catch(function (e) {
      log('房间 ' + room.code + ' 出错: ' + (e && e.message));
      room.started = false;
      room.busy = false;
      room.members.forEach(function (m) { if (m) send(m.ws, { t: 'error', msg: '对局异常: ' + (e && e.message) }); });
    }).then(function () { room.busy = false; });
  }

  function findOpenRoom(key) {
    let best = null;
    rooms.forEach(function (r) {
      if (!r.public || r.started || r.gameKey !== key) return;
      if (r.freeSeat() < 0) return;
      if (!best) best = r;
    });
    return best;
  }

  function scheduleAutoStart(room) {
    if (room.autoStartTimer) return;
    let left = room.matchCountdown;
    const tick = function () {
      if (room.started) { room.autoStartTimer = null; return; }
      const humans = room.members.filter(function (m) { return m && !m.bot; }).length;
      if (humans >= room.seatCount) { room.autoStartTimer = null; startRoom(room); return; }
      if (left <= 0) {
        room.autoStartTimer = null;
        startRoom(room);
        return;
      }
      room.members.forEach(function (m) {
        if (m && !m.bot) send(m.ws, { t: 'notice', msg: '匹配中… ' + left + ' 秒后开始（不足的座位由电脑补上）' });
      });
      room.spectators.forEach(function (s) {
        send(s.ws, { t: 'notice', msg: '匹配中… ' + left + ' 秒后开始' });
      });
      left -= 3;
      room.autoStartTimer = setTimeout(tick, 3000);
    };
    room.autoStartTimer = setTimeout(tick, 3000);
  }

  function leaveRoom(ws) {
    rooms.forEach(function (room, code) {
      const idx = room.members.findIndex(function (m) { return m && m.ws === ws; });
      if (idx >= 0) {
        const m = room.members[idx];
        if (room.started) {
          // 游戏中断线 → 交给电脑托管
          m.bot = true;
          m.name = m.name + '(托管)';
          m.pending = null;
          m.pendingAgain = null;
          broadcastRoomInfo(room);
        } else {
          room.members[idx] = null;
          if (!room.members.some(Boolean) && !room.spectators.length) {
            clearTimeout(room.autoStartTimer);
            rooms.delete(code);
          } else {
            if (room.hostId === m.id) {
              const nx = room.members.find(function (x) { return x && !x.bot; });
              room.hostId = nx ? nx.id : null;
            }
            broadcastRoomInfo(room);
          }
        }
      }
      const si = room.spectators.findIndex(function (s) { return s.ws === ws; });
      if (si >= 0) {
        room.spectators.splice(si, 1);
        broadcastRoomInfo(room);
      }
    });
  }

  wss.on('connection', function (ws) {
    ws.id = Math.random().toString(36).slice(2, 10);
    ws.isAlive = true;
    ws.on('pong', function () { ws.isAlive = true; });

    send(ws, { t: 'hello', id: ws.id, games: gamesMod.keys.map(function (k) { return { key: k, name: rulesMod.get(k).name, tagline: rulesMod.get(k).tagline, seats: rulesMod.get(k).seats }; }) });

    ws.on('message', function (raw) {
      let m;
      try { m = JSON.parse(String(raw)); } catch (e) { return send(ws, { t: 'error', msg: '消息格式错误' }); }

      if (m.t === 'list') {
        const list = [];
        rooms.forEach(function (r) {
          if (r.started) return;
          if (r.freeSeat() < 0) return;
          list.push(r.info());
        });
        return send(ws, { t: 'rooms', rooms: list });
      }

      if (m.t === 'create') {
        if (!rulesMod.get(m.game)) return send(ws, { t: 'error', msg: '未知玩法' });
        const room = new Room(m.game, {
          public: !!m.public,
          matchSeconds: opts.matchSeconds,
          botDelay: opts.botDelay,
          turnTimeout: opts.turnTimeout,
        });
        while (rooms.has(room.code)) room.code = makeCode();
        rooms.set(room.code, room);
        const seat = 0;
        room.members[seat] = { id: ws.id, ws: ws, name: m.name || '房主', bot: false, pending: null };
        room.hostId = ws.id;
        ws.roomCode = room.code;
        send(ws, { t: 'joined', code: room.code, seat: seat, host: true, room: room.info() });
        log('创建房间 ' + room.code + '（' + room.rules.name + '）by ' + (m.name || '房主'));
        broadcastRoomInfo(room);
        if (room.public) scheduleAutoStart(room);
        return;
      }

      if (m.t === 'join') {
        const code = String(m.code || '').toUpperCase();
        const room = rooms.get(code);
        if (!room) return send(ws, { t: 'error', msg: '房间 ' + code + ' 不存在' });
        const seat = room.freeSeat();
        if (seat < 0 && !room.started) return send(ws, { t: 'error', msg: '房间已满' });
        if (room.started) {
          room.spectators.push({ id: ws.id, ws: ws, name: m.name || '观众' });
          ws.roomCode = room.code;
          send(ws, { t: 'joined', code: room.code, seat: -1, spectator: true, room: room.info() });
          broadcastState(room);
          return;
        }
        room.members[seat] = { id: ws.id, ws: ws, name: m.name || ('玩家' + (seat + 1)), bot: false, pending: null };
        ws.roomCode = room.code;
        send(ws, { t: 'joined', code: room.code, seat: seat, host: room.hostId === ws.id, room: room.info() });
        log((m.name || '玩家') + ' 加入房间 ' + room.code + '（座位 ' + seat + '）');
        broadcastRoomInfo(room);
        if (room.public) scheduleAutoStart(room);
        return;
      }

      if (m.t === 'match') {
        const key = m.game;
        if (!rulesMod.get(key)) return send(ws, { t: 'error', msg: '未知玩法' });
        let room = findOpenRoom(key);
        if (!room) {
          room = new Room(key, {
            public: true,
            matchSeconds: opts.matchSeconds,
            botDelay: opts.botDelay,
            turnTimeout: opts.turnTimeout,
          });
          while (rooms.has(room.code)) room.code = makeCode();
          rooms.set(room.code, room);
          const seat0 = 0;
          room.members[seat0] = { id: ws.id, ws: ws, name: m.name || '玩家1', bot: false, pending: null };
          room.hostId = ws.id;
          ws.roomCode = room.code;
          send(ws, { t: 'joined', code: room.code, seat: seat0, host: true, room: room.info() });
          log('匹配新建房间 ' + room.code + '（' + room.rules.name + '）');
        } else {
          const seat = room.freeSeat();
          room.members[seat] = { id: ws.id, ws: ws, name: m.name || ('玩家' + (seat + 1)), bot: false, pending: null };
          ws.roomCode = room.code;
          send(ws, { t: 'joined', code: room.code, seat: seat, host: false, room: room.info() });
          log((m.name || '玩家') + ' 匹配进房间 ' + room.code);
        }
        broadcastRoomInfo(room);
        scheduleAutoStart(room);
        return;
      }

      const room = rooms.get(ws.roomCode);
      if (!room) return send(ws, { t: 'error', msg: '你还没有加入房间' });
      const mySeat = room.members.findIndex(function (x) { return x && x.ws === ws; });

      if (m.t === 'start') {
        if (ws.id !== room.hostId) return send(ws, { t: 'error', msg: '只有房主可以开始' });
        if (room.started) return;
        if (!room.members.some(Boolean)) return send(ws, { t: 'error', msg: '房间里没人' });
        return startRoom(room);
      }

      if (m.t === 'again') {
        const mm = room.members.find(function (x) { return x && x.id === ws.id; });
        if (mm && mm.pendingAgain) mm.pendingAgain(m.yes !== false);
        return;
      }

      if (m.t === 'act') {
        if (mySeat < 0) return;
        const mm = room.members[mySeat];
        if (!mm || !mm.pending) return send(ws, { t: 'error', msg: '现在不该你操作' });
        const p = mm.pending;
        mm.pending = null;
        return p(m.action);
      }

      if (m.t === 'chat') {
        const who = mySeat >= 0 && room.members[mySeat] ? room.members[mySeat].name : '观众';
        room.members.forEach(function (x) { if (x) send(x.ws, { t: 'chat', who: who, msg: String(m.msg).slice(0, 200) }); });
        room.spectators.forEach(function (s) { send(s.ws, { t: 'chat', who: who, msg: String(m.msg).slice(0, 200) }); });
        return;
      }

      if (m.t === 'leave') {
        ws.roomCode = null;
        return leaveRoom(ws);
      }
    });

    ws.on('close', function () {
      leaveRoom(ws);
    });
  });

  const heartbeat = setInterval(function () {
    wss.clients.forEach(function (ws) {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      try { ws.ping(); } catch (e) { /* ignore */ }
    });
  }, 30000);
  wss.on('close', function () { clearInterval(heartbeat); });

  wss.on('listening', function () {
    const addr = wss.address();
    log('斗地主服务器已启动  端口 ' + addr.port);
    log('局域网内的玩家用： npx dou-cl --join <本机IP>:' + addr.port);
  });
  wss.on('error', function (e) {
    log('服务器错误: ' + e.message);
  });

  return {
    wss: wss,
    port: port,
    rooms: rooms,
    close: function () { clearInterval(heartbeat); wss.close(); },
  };
}

module.exports = { createServer: createServer };
