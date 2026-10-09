'use strict';

/*
 * 生成 README / npm 页面用的图片（logo + 终端截图）
 *
 * 做法：用项目**真实的渲染器**产出终端文本（不是手写的假截图），
 *      ANSI 转成 HTML，再用系统自带的 Chrome 无头截图。
 *
 * 用法： node tools/make-docs.js
 * 产物： docs/*.png
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs');
const TMP = path.join(ROOT, '.imgtmp');

const color = require('../src/color');
const ui = require('../src/ui');
const skins = require('../src/skins');
const app = require('../src/app');
const gamesMod = require('../src/games');
const bot = require('../src/bot');

const FONT = '"Cascadia Mono","Consolas","Microsoft YaHei",monospace';
const FONT_SIZE = 13;
const LINE_H = 20;
const PAD_X = 18;
const PAD_Y = 14;
const BAR_H = 32;
const SCALE = 1;   // 必须 1：README 里图片是按原始像素显示再缩到栏宽的，2 倍图字会小一半

color.setEnabled(true);
ui.setAscii(false);

/* ------------------------------------------------------------------ */
/* Chrome                                                             */
/* ------------------------------------------------------------------ */

function findChrome() {
  const cands = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  for (const p of cands) if (fs.existsSync(p)) return p;
  throw new Error('没找到 Chrome/Edge，装一个再来跑');
}
const CHROME = findChrome();
const PROFILE = path.join(TMP, 'profile');

/* ------------------------------------------------------------------ */
/* ANSI -> HTML                                                       */
/* ------------------------------------------------------------------ */

const BASE16 = ['#1c1c1c', '#e5484d', '#3fa66a', '#d9a441', '#4a7fd0', '#b45fbf', '#4cb7d8', '#c9d1d9',
  '#7b8794', '#ff6b70', '#56c483', '#f0bb55', '#6c9ce8', '#d07ada', '#6fd0ec', '#ffffff'];

function c256hex(n) {
  n = Number(n);
  if (n < 16) return BASE16[n];
  if (n < 232) {
    const i = n - 16;
    const lv = function (v) { return v === 0 ? 0 : 55 + v * 40; };
    return rgb(lv(Math.floor(i / 36)), lv(Math.floor((i % 36) / 6)), lv(i % 6));
  }
  const v = 8 + (n - 232) * 10;
  return rgb(v, v, v);
}
function rgb(r, g, b) {
  const h = function (v) { return ('0' + v.toString(16)).slice(-2); };
  return '#' + h(r) + h(g) + h(b);
}
function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function ansiToHtml(s) {
  let out = '';
  let open = false;
  let st = {};
  const close = function () { if (open) { out += '</span>'; open = false; } };
  const reopen = function () {
    const css = Object.keys(st).filter(function (k) { return k !== 'dim' && st[k]; })
      .map(function (k) { return k + ':' + st[k]; }).join(';');
    if (css) { out += '<span style="' + css + '">'; open = true; }
  };
  let i = 0;
  while (i < s.length) {
    if (s[i] === '\u001b' && s[i + 1] === '[') {
      const m = /^\u001b\[([0-9;]+)m/.exec(s.slice(i));
      if (m) {
        const codes = m[1].split(';').map(Number);
        if (codes[0] === 0 && codes.length === 1) st = {};
        else {
          for (let k = 0; k < codes.length; k++) {
            const c = codes[k];
            if (c === 0) st = {};
            else if (c === 1) st['font-weight'] = '600';
            else if (c === 2) st.dim = true;
            else if (c >= 30 && c <= 37) st.color = BASE16[c - 30];
            else if (c === 90) st.color = '#7b8794';
            else if (c === 38 && codes[k + 1] === 5) { st.color = c256hex(codes[k + 2]); k += 2; }
          }
        }
        close();
        reopen();
        i += m[0].length;
        continue;
      }
    }
    out += esc(s[i]);
    i++;
  }
  close();
  return out;
}

/* ------------------------------------------------------------------ */
/* 页面模板                                                           */
/* ------------------------------------------------------------------ */

function page(body, opts) {
  opts = opts || {};
  const bg = opts.bg || '#ffffff00';
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>\n' +
    'html,body{margin:0;padding:' + (opts.margin || 0) + 'px;background:' + bg + '}\n' +
    '*{box-sizing:border-box}\n' +
    '#shot{display:inline-block}\n' +
    '.win{background:#12161c;border:1px solid #2b323c;border-radius:10px;overflow:hidden;' +
    'box-shadow:0 6px 24px rgba(0,0,0,.28)}\n' +
    '.bar{height:' + BAR_H + 'px;background:#1a2027;border-bottom:1px solid #2b323c;' +
    'display:flex;align-items:center;padding:0 13px;gap:7px}\n' +
    '.dot{width:11px;height:11px;border-radius:50%}\n' +
    '.r{background:#ff5f57}.y{background:#febc2e}.g{background:#28c840}\n' +
    '.title{margin-left:8px;font:12px ' + FONT + ';color:#6b7683;letter-spacing:.02em}\n' +
    'pre{margin:0;padding:' + PAD_Y + 'px ' + PAD_X + 'px;font:' + FONT_SIZE + 'px/' + LINE_H + 'px ' +
    FONT + ';color:#c9d1d9;white-space:pre;tab-size:2}\n' +
    (opts.css || '') +
    '</style></head><body>' +
    '<div id="shot">' + body + '</div>' +
    '<script>\n' +
    'function __size(){\n' +
    '  var r=document.getElementById("shot").getBoundingClientRect();\n' +
    '  document.body.setAttribute("data-size",Math.ceil(r.width)+"x"+Math.ceil(r.height));\n' +
    '}\n' +
    '__size();\n' +
    'window.addEventListener("load",__size);\n' +
    'if(document.fonts&&document.fonts.ready)document.fonts.ready.then(__size);\n' +
    '</script></body></html>';
}

/** 项目 logo / banner */
function logoSrc() {
  const mono = '"Cascadia Mono","Consolas",monospace';
  const sans = '"Microsoft YaHei","PingFang SC","Segoe UI",sans-serif';
  const css = [
    '.logo{background:#12161c;border:1px solid #2b323c;border-radius:14px;padding:26px 32px 20px;',
    'display:inline-block;box-shadow:0 6px 24px rgba(0,0,0,.28)}',
    '.logo .row{display:flex;align-items:center;gap:17px}',
    '.logo .tile{width:64px;height:64px;border-radius:15px;display:flex;align-items:center;',
    'justify-content:center;font-size:36px;line-height:1;color:#0e1218;',
    'background:linear-gradient(135deg,#8fd6a8,#4cb7d8)}',
    '.logo .name{font:600 42px/1 ' + mono + ';color:#e6edf3;letter-spacing:-1.5px}',
    '.logo .sub{font:14px/1.4 ' + sans + ';color:#7b8794;margin-top:7px}',
    '.logo .cmd{display:inline-block;margin-top:21px;font:15px/1 ' + mono + ';color:#72d5a0;',
    'background:#0c1015;border:1px solid #212832;border-radius:8px;padding:10px 15px}',
    '.logo .cmd .p{color:#5a6673}',
    '.logo .fake{margin-top:17px;font:11px/1 ' + mono + ';color:#333c48;white-space:pre}',
  ].join('');
  return page(
    '<div class="logo">' +
    '<div class="row"><div class="tile">\u2660</div><div>' +
    '<div class="name">dou-cl</div>' +
    '<div class="sub">\u547d\u4ee4\u884c\u724c\u684c \u00b7 \u6597\u5730\u4e3b / \u8dd1\u5f97\u5feb / 510K' +
    ' &nbsp;\u00b7&nbsp; \u9ed8\u8ba4\u4f2a\u88c5\u6210\u5f00\u53d1\u8f93\u51fa</div>' +
    '</div></div>' +
    '<div class="cmd"><span class="p">$</span> npx dou-cl</div>' +
    '<div class="fake">2026-10-09 10:19:31.159 INFO  deck.sync  hand[14]=[W As Ah Ac Js Jc Jd 8s 8d 7c 5s 5c 5d]  peers=[mei:17 fei:8]</div>' +
    '</div>',
    { css: css, margin: 6 }
  );
}

function win(title, text) {
  const lines = text.split('\n');
  const body = '<div class="win"><div class="bar">' +
    '<span class="dot r"></span><span class="dot y"></span><span class="dot g"></span>' +
    '<span class="title">' + esc(title) + '</span></div>' +
    '<pre>' + ansiToHtml(lines.join('\n')) + '</pre></div>';
  return page(body);
}

/** 抠掉首尾空行 */
function trim(text) {
  const lines = text.replace(/\u001b\[[0-9;]*m/g, function (m) { return m; }).split('\n');
  while (lines.length && !lines[0].replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').trim()) lines.pop();
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* 截图：先量尺寸，再按尺寸截                                          */
/* ------------------------------------------------------------------ */

function fileUrl(p) {
  return 'file:///' + p.replace(/\\/g, '/').replace(/^\/+/, '');
}

function run(args) {
  return execFileSync(CHROME, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
}

function shoot(name, html) {
  const hp = path.join(TMP, name + '.html');
  fs.writeFileSync(hp, html, 'utf8');

  // 1) 量出内容真实尺寸
  const dom = run([
    '--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--user-data-dir=' + PROFILE, '--no-first-run', '--no-default-browser-check',
    '--virtual-time-budget=3000',
    '--window-size=2000,2000', '--dump-dom', fileUrl(hp),
  ]);
  const m = /data-size="(\d+)x(\d+)"/.exec(dom);
  if (!m) throw new Error(name + '：量不到尺寸');
  const w = Number(m[1]);
  const h = Number(m[2]);

  // 2) 按尺寸截（背景透明）
  const png = path.join(OUT, name + '.png');
  const args = [
    '--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--user-data-dir=' + PROFILE, '--no-first-run', '--no-default-browser-check',
    '--default-background-color=00000000',
    '--screenshot=' + png,
    '--window-size=' + w + ',' + h,
  ];
  if (SCALE !== 1) args.splice(5, 0, '--force-device-scale-factor=' + SCALE);
  run(args.concat([fileUrl(hp)]));
  const kb = (fs.statSync(png).size / 1024).toFixed(0);
  console.log('  ' + name.padEnd(16) + w + 'x' + h + '   ' + kb + ' KB');
  return { name: name, w: w, h: h };
}

/* ------------------------------------------------------------------ */
/* 内容                                                               */
/* ------------------------------------------------------------------ */

function captureIO() {
  return {
    lines: [],
    handler: null,
    clear: function () {}, block: function () {}, close: function () {},
    say: function (t) { this.lines.push(String(t)); },
    ask: function (p, h) { this.handler = h; },
  };
}

/** 造一个真实的中局 */
function midGame(key, steps, skin) {
  const engine = gamesMod.create(key);
  const names = ['小美', '阿飞', '老王'];
  const players = [{ name: '你', bot: false }];
  for (let i = 1; i < engine.rules.seats; i++) players.push({ name: names[i - 1], bot: true });
  const st = engine.start(players);
  for (let i = 0; i < steps && !st.over; i++) {
    const seat = engine.asker(st);
    if (seat === null) break;
    if (!engine.apply(st, seat, bot.chooseAction(engine, st, seat)).ok) break;
  }
  if (skin) {
    skins.setKey(skin);
    skins.render(engine.view(st, 0), 0, {});     // 第一帧（diff 皮肤要有底）
  }
  let guard = 0;
  while (!st.over && st.turn !== 0 && st.phase === 'play' && guard++ < 40) {
    if (!engine.apply(st, st.turn, bot.chooseAction(engine, st, st.turn)).ok) break;
  }
  const view = engine.view(st, 0);
  const text = skin ? skins.render(view, 0, {}) : ui.renderTable(view, 0, {});
  if (skin) skins.setKey('term');
  return text;
}

/* ------------------------------------------------------------------ */

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });
  console.log('Chrome: ' + CHROME);
  console.log('生成中…\n');
  const shots = [];

  // ---- logo ----
  shots.push(shoot('logo', logoSrc()));

  // ---- 菜单 ----
  const mio = captureIO();
  app.showMenu(mio, { server: '127.0.0.1:8080', port: 8080, speed: 700, skin: 'log' });
  shots.push(shoot('menu', win('dou-cl', trim(mio.lines.join('\n')))));

  // ---- 原生牌桌 ----
  shots.push(shoot('table', win('dou-cl -g doudizhu --skin term', trim(midGame('doudizhu', 6, null)))));

  // ---- 四种伪装皮肤 ----
  shots.push(shoot('skin-log', win('tail -f logs/deck-sync.log', trim(midGame('doudizhu', 7, 'log')))));
  shots.push(shoot('skin-hex', win('xxd -c 24 logs/deck-sync.log', trim(midGame('fivek', 9, 'hex')))));
  shots.push(shoot('skin-json', win('ws-client', trim(midGame('paodekuai', 9, 'json')))));
  shots.push(shoot('skin-diff', win('git diff -U50 -- src/deck/session.yaml', trim(midGame('doudizhu', 10, 'diff')))));

  // ---- 联网房间 ----
  const net = [
    '',
    '  房间 ABCD   斗地主 \u00b7 3 人',
    '  ' + '\u2500'.repeat(50),
    '   1号位  你',
    '   2号位  阿飞',
    '   3号位  空',
    '  ' + '\u2500'.repeat(50),
    '   把房间号发给朋友，或让他们执行：',
    '   npx dou-cl --join 192.168.1.10:8080 --code ABCD',
    '',
    '  按 Enter 开始游戏（不足的位置由电脑补上）> ',
  ].join('\n');
  shots.push(shoot('net', win('dou-cl --create doudizhu', trim(net))));

  console.log('\n共 ' + shots.length + ' 张，输出到 docs/');
}

main();
