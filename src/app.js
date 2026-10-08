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
  const skinned = ui.skinHelp(r.help);
  if (skinned !== null) { process.stdout.write(skinned); return; }
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

/** 摸鱼模式下的“玩法说明”（同样是伪装的） */
function printStealthHelp() {
  const lines = [];
  lines.push('输出里每张牌是两个字符：点数 + 花色');
  lines.push('  点数  3 4 5 6 7 8 9 0(=10) J Q K A 2      w=小王   W=大王');
  lines.push('  花色  s=黑桃  h=红桃  c=梅花  d=方块');
  lines.push('');
  lines.push('hand[]    = 你自己的手牌（就是这两个字符一组）');
  lines.push('peers[]   = 其他人还剩几张');
  lines.push('table=    = 场上最大的一手；管得上就出，管不上就 pass');
  lines.push('turn=     = 轮到谁，self 是你');
  lines.push('');
  lines.push('出牌 34567 或 3 4 5 6 7      带花色 5s 5h');
  lines.push('pass | p    hint | h    redraw    reveal 看真身    skin <名>    quit');
  const skinned = ui.skinHelp(lines);
  process.stdout.write(skinned !== null ? skinned : lines.join('\n') + '\n');
}

function printSkinHelp() {
  const list = ui.skinList();
  const lines = ['可用皮肤：'];
  lines.push('  term   原生牌桌（默认）');
  list.forEach(function (s) { lines.push('  ' + s.key.padEnd(6) + ' ' + s.desc); });
  const skinned = ui.skinHelp(lines);
  process.stdout.write(skinned !== null ? skinned : lines.join('\n') + '\n');
}

/* ------------------------------------------------------------------ */
/* 渲染                                                               */
/* ------------------------------------------------------------------ */

/** 本地对局里人类永远坐 0 号位 —— 渲染视角必须固定在他身上，
 *  不能跟着“当前出牌方”走，否则电脑出牌时会把电脑的手牌当你的显示出来。 */
const HUMAN = 0;

function renderLocal(io, engine, state) {
  const view = engine.view(state, HUMAN);
  const skinned = ui.renderSkin(view, HUMAN, {});
  if (skinned !== null) {
    io.block(skinned);
  } else {
    io.clear();
    process.stdout.write(ui.renderTable(view, HUMAN, {}) + '\n');
  }
  return view;
}

/* ------------------------------------------------------------------ */
/* 人类输入                                                           */
/* ------------------------------------------------------------------ */

function askHuman(io, engine, state, seat, key) {
  return new Promise(function (resolve) {
    const skin = ui.skinActive();

    const complain = function (msg) {
      io.block(skin ? ui.skinMessage(msg) : colors.red(msg));
    };

    const step = function () {
      const view = engine.view(state, seat);
      let promptText;
      if (skin) promptText = ui.skinPrompt();
      else if (view.phase === 'bid') promptText = '\n叫分 (0=不叫 1/2/3=叫分, ?=帮助) > ';
      else promptText = '\n出牌 > ';

      io.ask(promptText, function (line) {
        const low = line.toLowerCase();
        if (!line) return step();

        // ---- 摸鱼模式专用命令 ----
        if (skin) {
          if (low === 'reveal' || low === 'real') {
            process.stdout.write(ui.renderTable(view, seat, {}) + '\n');
            return step();
          }
          if (low === 'redraw' || low === 'rr') {
            io.block(ui.renderSkin(view, seat, {}));
            return step();
          }
          if (low.indexOf('skin') === 0) {
            const k = low.split(/\s+/)[1];
            if (!k) { printSkinHelp(); return step(); }
            try {
              ui.setSkin(k);
              io.block(ui.skinMessage('skin -> ' + ui.skinKey()));
            } catch (e) {
              io.block(ui.skinMessage(e.message));
            }
            return step();
          }
        }

        if (low === '?' || low === 'help' || low === 'rules') {
          if (skin) printStealthHelp(); else printHelp(key);
          return step();
        }
        if (low === 'skins' || low === 'skin' ) { printSkinHelp(); return step(); }
        if (low === 'quit' || low === 'exit') {
          if (!skin) io.say(colors.dim('已退出本局。'));
          io.close();
          return;
        }

        let action = null;

        if (view.phase === 'bid') {
          const v = parseInt(line, 10);
          if (isNaN(v) || v < 0 || v > 3) { complain('叫分只能是 0 / 1 / 2 / 3'); return step(); }
          action = { type: 'bid', score: v };
        } else if (low === 'p' || low === 'pass' || line === '不要' || line === '过' || line === '不出') {
          action = { type: 'pass' };
        } else if (low === 'h' || low === 'hint' || line === '提示') {
          const act = bot.chooseAction(engine, state, seat);
          let msg;
          if (act.type === 'pass') {
            msg = '没有能管上的牌，只能不要（pass）';
          } else {
            const cards = view.hand.filter(function (c) { return act.ids.indexOf(c.id) >= 0; });
            const co = comboMod.analyze(cards, engine.rules);
            msg = 'hint: ' + ui.handText(cards) + '  [' + (co ? comboMod.typeName(co.type) : '') + ']';
          }
          io.block(skin ? ui.skinMessage(msg) : msg);
          return step();
        } else {
          const parsed = ui.parseCardInput(line, view.hand);
          if (!parsed.ok) { complain(parsed.err); return step(); }
          action = { type: 'play', ids: parsed.ids };
        }

        const v = engine.validate(state, seat, action);
        if (!v.ok) { complain(v.err); return step(); }
        resolve(action);
      });
    };
    step();
  });
}

/* ------------------------------------------------------------------ */
/* 本地（单机）对局                                                   */
/* ------------------------------------------------------------------ */

async function playLocal(io, key, opts) {
  const rules = rulesMod.get(key);
  const engine = gamesMod.create(key);
  const names = ['你', '小美', '阿飞', '老王', '阿强'];
  const players = [];
  for (let i = 0; i < rules.seats; i++) {
    players.push({ name: i === 0 ? '你' : names[i], bot: i !== 0 });
  }

  ui.resetSkin();

  const results = [];
  let round = 1;
  while (true) {
    if (ui.skinActive()) {
      io.block(ui.skinMessage('session_start pool=' + require('./skins').session().pool +
        ' svc=deck-sync game=' + key + ' seats=' + rules.seats + ' round=' + round));
    } else {
      io.clear();
      io.say('');
      io.say(colors.bold('  ' + rules.name + '  ·  第 ' + round + ' 局'));
      io.say(colors.dim('  ' + rules.tagline));
    }

    const decider = async function (state, seat) {
      renderLocal(io, engine, state);
      if (players[seat].bot) {
        await sleep(opts.speed);
        return bot.chooseAction(engine, state, seat);
      }
      if (state.phase === 'play' && state.extra.needSpade3 && seat === HUMAN) {
        io.block(ui.skinActive()
          ? ui.skinMessage('first hand must contain spade-3 (3s)')
          : colors.yellow('  提醒：首手必须带上 ♠3'));
      }
      return askHuman(io, engine, state, seat, key);
    };

    let state;
    let tries = 0;
    do {
      state = await runner.runDeal(engine, players, decider, null, {});
      tries++;
    } while (state.result && state.result.type === 'redeal' && tries < 5);

    renderLocal(io, engine, state);
    results.push(state);
    round++;

    const again = await new Promise(function (resolve) {
      io.ask(ui.skinActive() ? ui.skinPrompt() : '\n再来一局？(y = 继续 / 其它 = 返回菜单) > ',
        function (l) { resolve(/^y/i.test(l.trim())); });
    });
    if (!again) break;
  }
  return results;
}

/* ------------------------------------------------------------------ */
/* 菜单                                                               */
/* ------------------------------------------------------------------ */

function banner() {
  return [
    '',
    colors.bold('  dou-cl') + colors.dim('   v' + require('../package.json').version),
    '',
  ].join('\n');
}

const MENU_SINGLE = [
  ['1', 'doudizhu', '斗地主', '3 人 · 17 张 + 3 张底牌'],
  ['2', 'paodekuai', '跑得快', '3 人 · 一副牌去掉大小王'],
  ['3', 'fivek', '510K', '4 人 · 两副牌 · 5/10/K 计分'],
];

function showMenu(io, opts) {
  io.clear();
  io.say(banner());
  io.say('  ' + '\u2500'.repeat(58));
  io.say('   ' + colors.bold('单机'));
  MENU_SINGLE.forEach(function (m) {
    io.say('    ' + colors.bold(m[0]) + '  ' + m[2] + '  ' + colors.dim(m[3]));
  });
  io.say('');
  io.say('   ' + colors.bold('联机'));
  io.say('    ' + colors.bold('4') + '  创建房间        ' +
    colors.bold('5') + '  加入房间');
  io.say('    ' + colors.bold('6') + '  快速匹配        ' +
    colors.bold('7') + '  本机开服务器');
  io.say('');
  io.say('    ' + colors.bold('0') + '  退出');
  io.say('  ' + '\u2500'.repeat(58));
  io.say(colors.dim('   直接回车 = 1（单机斗地主）'));

  io.ask('\n请选择 > ', function (line) {
    const c = (line || '1').trim();
    if (c === '0') { io.say('再见！'); io.close(); return; }
    if (c === '1' || c === '2' || c === '3') {
      const key = MENU_SINGLE[Number(c) - 1][1];
      playLocal(io, key, opts).then(function () { showMenu(io, opts); })
        .catch(function (e) { io.say(colors.red('出错: ' + e.message)); showMenu(io, opts); });
      return;
    }
    if (c === '4' || c === '5' || c === '6') {
      onlineFlow(io, String(Number(c) - 3), opts).catch(function (e) {
        io.say(colors.red('出错: ' + e.message));
        showMenu(io, opts);
      });
      return;
    }
    if (c === '7') { startServerFlow(io, opts.port); return; }
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

  if (choice === '1') {
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

  if (choice === '2') {
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
  server.createServer({ port: port || 8080 });
  io.say(colors.dim('  本机 IP 可以用 ipconfig 查，别人执行： npx dou-cl --join <你的IP>:' + (port || 8080)));
  io.say(colors.dim('  也可以让别人快速匹配： npx dou-cl --match doudizhu --server <你的IP>:' + (port || 8080)));
  io.handler = null;
}

/* ------------------------------------------------------------------ */

module.exports = {
  playLocal: playLocal,
  showMenu: showMenu,
  printHelp: printHelp,
  printStealthHelp: printStealthHelp,
  printSkinHelp: printSkinHelp,
  banner: banner,
  ask: ask,
};
