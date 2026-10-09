'use strict';

/*
 * 本地对局回归测试
 * 关键不变式：渲染视角必须永远是 0 号位（人类），
 * 且画面上“你的手牌”必须等于 0 号位的真实手牌。
 * （v1 曾经按“当前出牌方”的视角渲染 —— 电脑出牌时会把电脑的牌当你的显示出来。）
 */

const app = require('../src/app');
const ui = require('../src/ui');
const bot = require('../src/bot');
const gamesMod = require('../src/games');
const rulesMod = require('../src/core/rules');
const C = require('../src/core/cards');

let fails = 0;
function ok(cond, msg) {
  console.log((cond ? '  \u2713 ' : '  \u2717 ') + msg);
  if (!cond) fails++;
}

const origSkin = ui.renderSkin;
const origTable = ui.renderTable;
const origWrite = process.stdout.write;

let seatSeen = {};
let badHand = 0;
let renders = 0;
let lastView = null;

function spy(view, seat) {
  renders++;
  seatSeen[seat] = (seatSeen[seat] || 0) + 1;
  lastView = view;
  // 画面上“你的手牌”必须是 0 号位的
  const humanCount = view.seats[0] ? view.seats[0].count : -1;
  if (view.hand.length !== humanCount) badHand++;
  return null;
}

function makeIO() {
  const io = {
    handler: null,
    clear: function () {},
    say: function () {},
    block: function () {},
    close: function () {},
    ask: function (prompt, handler) {
      this.handler = handler;
      const self = this;
      setImmediate(function () { answer(handler); });
    },
  };
  return io;
}

function answer(handler) {
  const v = lastView;
  if (!v) { handler('n'); return; }
  if (v.over) { handler('n'); return; }              // 不再来一局
  if (v.phase === 'bid') { handler('3'); return; }   // 直接叫 3 分
  const act = bot.hintFromView(v, 0);
  if (!act || act.type !== 'play' || !act.ids || !act.ids.length) { handler('p'); return; }
  const cards = v.hand.filter(function (c) { return act.ids.indexOf(c.id) >= 0; });
  handler(cards.map(function (c) {
    return c.r >= 16 ? C.rankChar(c.r) : C.rankChar(c.r) + C.SUIT_LETTERS[c.s].toLowerCase();
  }).join(' '));
}

async function run(key, skin) {
  seatSeen = {};
  badHand = 0;
  renders = 0;
  lastView = null;
  ui.setSkin(skin || 'term');
  ui.renderSkin = spy;
  ui.renderTable = spy;
  process.stdout.write = function () { return true; };

  const io = makeIO();
  await app.playLocal(io, key, { speed: 0, server: '127.0.0.1:8080', port: 0 });

  ui.renderSkin = origSkin;
  ui.renderTable = origTable;
  process.stdout.write = origWrite;

  const seats = Object.keys(seatSeen).map(Number);
  ok(seats.length === 1 && seats[0] === 0,
    key + (skin && skin !== 'term' ? ' + ' + skin : '') + '：渲染视角始终是 0 号位（出现过 ' + JSON.stringify(seatSeen) + '）');
  ok(badHand === 0,
    key + (skin && skin !== 'term' ? ' + ' + skin : '') + '：“你的手牌”张数始终等于 0 号位手牌（' + renders + ' 次渲染，0 次错位）');
}

async function main() {
  console.log('\n[default] 默认就是摸鱼模式');
  const skins = require('../src/skins');
  ok(skins.getKey() === skins.DEFAULT_SKIN, '默认皮肤 = ' + skins.DEFAULT_SKIN + '（不用再选“是不是摸鱼模式”）');
  ok(ui.skinActive(), '默认开启伪装');

  const lines = [];
  const menuIO = {
    clear: function () {},
    say: function (t) { lines.push(String(t)); },
    ask: function () {},
    close: function () {},
  };
  app.showMenu(menuIO, { server: '127.0.0.1:8080', port: 0, speed: 0 });
  const menuText = lines.join('\n');
  ok(menuText.indexOf('摸鱼') < 0, '菜单里已经没有“摸鱼模式”这一项');
  ok(menuText.indexOf('斗地主') >= 0 && menuText.indexOf('跑得快') >= 0 && menuText.indexOf('510K') >= 0,
    '菜单只让选玩法（斗地主 / 跑得快 / 510K）');
  ok(menuText.indexOf('加入房间') >= 0 && menuText.indexOf('开一个房间') >= 0,
    '菜单只让选联机方式（加入房间 / 开一个房间）');
  ok(menuText.indexOf('快速匹配') < 0 && menuText.indexOf('创建房间') < 0,
    '菜单里不再有“创建房间 / 快速匹配”这些旧模式的选项');

  console.log('\n[local] 本地对局视角');
  await run('doudizhu');
  await run('paodekuai');
  await run('fivek');
  console.log('\n[local] 摸鱼模式下同样成立');
  await run('doudizhu', 'log');
  await run('paodekuai', 'hex');
  await run('fivek', 'json');
  console.log('');
  if (fails) { console.log(fails + ' 项失败'); process.exit(1); }
  console.log('本地视角ok。');
  process.exit(0);
}

main().catch(function (e) { console.error(e); process.exit(1); });
