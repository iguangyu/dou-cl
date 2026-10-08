'use strict';

const rulesMod = require('./core/rules');
const gamesMod = require('./games');
const bot = require('./bot');
const ui = require('./ui');
const runner = require('./runner');
const comboMod = require('./core/combo');

const colors = ui.colors;
const sleep = runner.sleep;

/* ------------------------------------------------------------------ */
/* 帮助                                                               */
/* ------------------------------------------------------------------ */

function printHelp(key) {
  const r = rulesMod.get(key);
  console.log('');
  console.log(colors.bold('  ' + r.name) + colors.dim('   ' + r.tagline));
  r.help.forEach(function (h) { console.log('   ' + h); });
  console.log('');
  console.log(colors.bold('  操作'));
  console.log('   出牌：直接输入点数，例  3 4 5 6 7   或   34567');
  console.log('         要指定花色就写在点数后面，例  5s 5h 5c');
  console.log('         点数对照： 3 4 5 6 7 8 9 0(=10) J Q K A 2 w(小王) W(大王)');
  console.log('   命令： p / pass = 不要     h / hint = 提示     ? = 帮助     quit = 退出');
  console.log('');
}

/* ------------------------------------------------------------------ */
/* 本地（单机）对局                                                   */
/* ------------------------------------------------------------------ */

function renderLocal(io, engine, state, seat) {
  io.clear();
  const view = engine.view(state, seat);
  process.stdout.write(ui.renderTable(view, seat, {}) + '\n');
  return view;
}

function askHuman(io, engine, state, seat, key) {
  return new Promise(function (resolve) {
    const step = function () {
      const view = engine.view(state, seat);
      let promptText;
      if (view.phase === 'bid') promptText = '\n叫分 (0=不叫 1/2/3=叫分, ?=帮助) > ';
      else promptText = '\n出牌 > ';

      io.ask(promptText, function (line) {
        const low = line.toLowerCase();
        if (!line) return step();
        if (low === '?' || low === 'help') { printHelp(key); return step(); }
        if (low === 'q' && view.phase === 'bid') return step();
        if (low === 'quit' || low === 'exit') {
          io.say(colors.dim('已退出本局。'));
          process.exit(0);
        }

        let action = null;

        if (view.phase === 'bid') {
          const v = parseInt(line, 10);
          if (isNaN(v) || v < 0 || v > 3) { io.say(colors.red('叫分只能是 0 / 1 / 2 / 3')); return step(); }
          action = { type: 'bid', score: v };
        } else if (low === 'p' || low === 'pass' || line === '不要' || line === '过' || line === '不出') {
          action = { type: 'pass' };
        } else if (low === 'h' || low === 'hint' || line === '提示') {
          const act = bot.chooseAction(engine, state, seat);
          if (act.type === 'pass') {
            io.say(colors.dim('没有能管上的牌，只能不要（按 p）。'));
          } else {
            const cards = view.hand.filter(function (c) { return act.ids.indexOf(c.id) >= 0; });
            const co = comboMod.analyze(cards, engine.rules);
            io.say('提示: ' + ui.handText(cards) + colors.dim('   ' + (co ? comboMod.typeName(co.type) : '')));
          }
          return step();
        } else {
          const parsed = ui.parseCardInput(line, view.hand);
          if (!parsed.ok) { io.say(colors.red(parsed.err)); return step(); }
          action = { type: 'play', ids: parsed.ids };
        }

        const v = engine.validate(state, seat, action);
        if (!v.ok) { io.say(colors.red(v.err)); return step(); }
        resolve(action);
      });
    };
    step();
  });
}

async function playLocal(io, key, opts) {
  const rules = rulesMod.get(key);
  const engine = gamesMod.create(key);
  const names = ['你', '小美', '阿飞', '老王', '阿强'];
  const players = [];
  for (let i = 0; i < rules.seats; i++) {
    players.push({ name: i === 0 ? '你' : names[i], bot: i !== 0 });
  }

  const results = [];
  let round = 1;
  while (true) {
    io.clear();
    io.say('');
    io.say(colors.bold('  ' + rules.name + '  ·  第 ' + round + ' 局'));
    io.say(colors.dim('  ' + rules.tagline));

    const decider = async function (state, seat) {
      renderLocal(io, engine, state, seat);
      if (players[seat].bot) {
        await sleep(opts.speed);
        return bot.chooseAction(engine, state, seat);
      }
      if (state.phase === 'play' && state.extra.needSpade3 && seat === 0) {
        io.say(colors.yellow('  提醒：首手必须带上 ♠3'));
      }
      return askHuman(io, engine, state, seat, key);
    };

    let state;
    let tries = 0;
    do {
      state = await runner.runDeal(engine, players, decider, null, {});
      tries++;
    } while (state.result && state.result.type === 'redeal' && tries < 5);

    renderLocal(io, engine, state, 0);
    results.push(state);
    round++;

    const again = await new Promise(function (resolve) {
      io.ask('\n再来一局？(y = 继续 / 其它 = 返回菜单) > ', function (l) { resolve(/^y/i.test(l.trim())); });
    });
    if (!again) break;
  }
  return results;
}

/* ------------------------------------------------------------------ */
/* 菜单                                                               */
/* ------------------------------------------------------------------ */

function banner() {
  const g = gamesMod.keys.map(function (k) { return rulesMod.get(k).name; }).join(' / ');
  return [
    '',
    colors.bold('  \u265f  dou-cl  \u00b7  命令行牌桌'),
    colors.dim('  ' + g + '  \u00b7  \u5355\u673a + \u8054\u7f51'),
    '',
  ].join('\n');
}

const MENU = [
  ['1', '单机 斗地主', 'doudizhu'],
  ['2', '单机 跑得快', 'paodekuai'],
  ['3', '单机 510K', 'fivek'],
  ['4', '联网 · 创建房间', null],
  ['5', '联网 · 加入房间', null],
  ['6', '联网 · 快速匹配', null],
  ['7', '启动服务器（让别人连你）', null],
  ['0', '退出', null],
];

function showMenu(io, opts) {
  io.clear();
  io.say(banner());
  io.say('  ' + '\u2500'.repeat(52));
  MENU.forEach(function (m) {
    io.say('   ' + colors.bold(m[0]) + '  ' + m[1]);
  });
  io.say('  ' + '\u2500'.repeat(52));
  io.say(colors.dim('   直接回车 = 1（单机斗地主）'));

  io.ask('\n请选择 > ', function (line) {
    const c = (line || '1').trim();
    if (c === '0') { io.say('再见！'); io.close(); return; }
    if (c === '1' || c === '2' || c === '3') {
      const key = MENU[Number(c) - 1][2];
      playLocal(io, key, opts).then(function () { showMenu(io, opts); })
        .catch(function (e) { io.say(colors.red('出错: ' + e.message)); showMenu(io, opts); });
      return;
    }
    if (c === '4' || c === '5' || c === '6') {
      onlineFlow(io, c, opts).catch(function (e) {
        io.say(colors.red('出错: ' + e.message));
        showMenu(io, opts);
      });
      return;
    }
    if (c === '7') {
      const portLine = opts.port;
      startServerFlow(io, portLine);
      return;
    }
    io.say(colors.red('没有这个选项：' + c));
    setTimeout(function () { showMenu(io, opts); }, 600);
  });
}

function ask(io, prompt) {
  return new Promise(function (resolve) {
    io.ask(prompt, function (l) { resolve(l.trim()); });
  });
}

async function onlineFlow(io, choice, opts) {
  io.clear();
  io.say('');
  const name = await ask(io, ' 你的昵称 > ') || '玩家';

  if (choice === '4') {
    io.say('');
    io.say(' 选择玩法： 1 斗地主   2 跑得快   3 510K');
    const g = await ask(io, ' > ');
    const key = ({ '1': 'doudizhu', '2': 'paodekuai', '3': 'fivek' })[g.trim()] || 'doudizhu';
    const srv = await ask(io, ' 服务器地址（直接回车 = 本机 ' + opts.server + '） > ') || opts.server;
    io.close();
    const client = require('./net/client');
    await client.runClient(new ui.IO(), { mode: 'create', game: key, name: name, server: srv }, opts);
    return;
  }

  if (choice === '5') {
    const code = await ask(io, ' 房间号（4 位） > ');
    const srv = await ask(io, ' 服务器地址（直接回车 = 本机 ' + opts.server + '） > ') || opts.server;
    io.close();
    const client = require('./net/client');
    await client.runClient(new ui.IO(), { mode: 'join', code: code.toUpperCase(), name: name, server: srv }, opts);
    return;
  }

  io.say('');
  io.say(' 选择玩法： 1 斗地主   2 跑得快   3 510K');
  const g = await ask(io, ' > ');
  const key = ({ '1': 'doudizhu', '2': 'paodekuai', '3': 'fivek' })[g.trim()] || 'doudizhu';
  const srv = await ask(io, ' 服务器地址（直接回车 = 本机 ' + opts.server + '） > ') || opts.server;
  io.close();
  const client = require('./net/client');
  await client.runClient(new ui.IO(), { mode: 'match', game: key, name: name, server: srv }, opts);
}

function startServerFlow(io, port) {
  io.clear();
  io.say('');
  io.say('  启动服务器…（Ctrl+C 停止）');
  const server = require('./net/server');
  const s = server.createServer({ port: port || 8080 });
  io.say(colors.dim('  本机 IP 可以用 ipconfig 查，别人执行： npx dou-cl --join <你的IP>:' + (port || 8080)));
  io.say(colors.dim('  也可以让别人快速匹配： npx dou-cl --match doudizhu --server <你的IP>:' + (port || 8080)));
  io.handler = null;
}

/* ------------------------------------------------------------------ */

module.exports = {
  playLocal: playLocal,
  showMenu: showMenu,
  printHelp: printHelp,
  banner: banner,
  ask: ask,
};
