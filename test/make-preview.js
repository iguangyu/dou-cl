'use strict';

/* 用真实渲染结果生成一个静态预览页，方便没跑之前先看看长什么样 */

const fs = require('fs');
const path = require('path');
const gamesMod = require('../src/games');
const bot = require('../src/bot');
const ui = require('../src/ui');

ui.setAscii(false);

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function monoToHtml(s) {
  // 把 ANSI 颜色转成 span
  const map = { '31': 'r', '36': 'c', '33': 'y', '32': 'g', '2': 'd', '1': 'b' };
  let out = '';
  let i = 0;
  let open = [];
  while (i < s.length) {
    if (s[i] === '\u001b' && s[i + 1] === '[') {
      const m = /^\u001b\[([0-9;]+)m/.exec(s.slice(i));
      if (m) {
        const codes = m[1].split(';');
        let cls = null;
        codes.forEach(function (c) { if (map[c]) cls = map[c]; });
        if (cls) {
          out += '<span class="' + cls + '">';
          open.push(cls);
        } else {
          // 复位
          while (open.length) { out += '</span>'; open.pop(); }
        }
        i += m[0].length;
        continue;
      }
    }
    out += esc(s[i]);
    i++;
  }
  while (open.length) { out += '</span>'; open.pop(); }
  return out;
}

function screenFor(key, steps) {
  const engine = gamesMod.create(key);
  const ruleSet = engine.rules;
  const players = [{ name: '你', bot: false }];
  const names = ['小美', '阿飞', '老王'];
  for (let i = 1; i < ruleSet.seats; i++) players.push({ name: names[i - 1], bot: true });
  const st = engine.start(players);
  for (let i = 0; i < steps && !st.over; i++) {
    const seat = engine.asker(st);
    if (seat === null) break;
    const a = bot.chooseAction(engine, st, seat);
    if (!engine.apply(st, seat, a).ok) break;
    // 让人类座位也走掉，避免一直卡在叫分
    if (st.phase === 'bid' && st.turn === 0) {
      const b = bot.chooseAction(engine, st, 0);
      if (!engine.apply(st, 0, b).ok) break;
    }
  }
  // 让人类轮到出牌，画面更好看
  let guard = 0;
  while (!st.over && st.turn !== 0 && st.phase === 'play' && guard++ < 60) {
    const a = bot.chooseAction(engine, st, st.turn);
    if (!engine.apply(st, st.turn, a).ok) break;
  }
  const view = engine.view(st, 0);
  let text = ui.renderTable(view, 0, {});
  const prompt = view.phase === 'bid'
    ? '\n叫分 (0=不叫 1/2/3=叫分, ?=帮助) > _'
    : '\n出牌 (例: 34567 或 5 5 5 6 / p 不要 / h 提示 / ? 帮助) > _';
  return text + (view.over ? '' : prompt);
}

const sections = [
  { key: 'doudizhu', steps: 4, title: '斗地主', cmd: 'npx dou-cl -g doudizhu' },
  { key: 'paodekuai', steps: 6, title: '跑得快', cmd: 'npx dou-cl -g paodekuai' },
  { key: 'fivek', steps: 6, title: '510K', cmd: 'npx dou-cl -g fivek' },
];

const blocks = sections.map(function (sec) {
  const text = screenFor(sec.key, sec.steps);
  return { title: sec.title, cmd: sec.cmd, html: monoToHtml(text) };
});

const menuText = [
  '',
  '  \u265f  dou-cl  \u00b7  命令行牌桌',
  '  斗地主 / 跑得快 / 510K  \u00b7  单机 + 联网',
  '',
  '  ' + '\u2500'.repeat(52),
  '   1  单机 斗地主',
  '   2  单机 跑得快',
  '   3  单机 510K',
  '   4  联网 \u00b7 创建房间',
  '   5  联网 \u00b7 加入房间',
  '   6  联网 \u00b7 快速匹配',
  '   7  启动服务器（让别人连你）',
  '   0  退出',
  '  ' + '\u2500'.repeat(52),
  '   直接回车 = 1（单机斗地主）',
  '',
  '请选择 > _',
].join('\n');

const netText = [
  '',
  '  房间 ABCD   斗地主 \u00b7 3 人',
  '  ' + '\u2500'.repeat(50),
  '   1号位  你',
  '   2号位  空',
  '   3号位  空',
  '  ' + '\u2500'.repeat(50),
  '   把房间号发给朋友，或让他们执行：',
  '   npx dou-cl --join 192.168.1.10:8080 --code ABCD',
  '',
  '  按 Enter 开始游戏（不足的位置由电脑补上）> _',
].join('\n');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>dou-cl 命令行斗地主 · 效果预览</title>
<style>
  :root{
    --bg:#f6f7f9; --card:#ffffff; --ink:#1c2024; --sub:#666f7a;
    --line:#e3e6ea; --term:#12161c; --termink:#d7dee8;
    --red:#e5484d; --cyan:#4cb7d8; --yellow:#d9a441; --green:#3fa66a; --dim:#7b8794;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
    line-height:1.6;padding:28px 18px 60px}
  .wrap{max-width:900px;margin:0 auto}
  h1{font-size:24px;margin:0 0 6px}
  .lead{color:var(--sub);margin:0 0 22px;font-size:14px}
  h2{font-size:16px;margin:30px 0 10px;display:flex;align-items:center;gap:10px}
  h2 .cmd{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;
    background:#eef1f4;border:1px solid var(--line);border-radius:6px;padding:2px 8px;color:var(--sub);font-weight:400}
  .term{background:var(--term);border-radius:10px;padding:16px 18px;overflow-x:auto}
  .term pre{margin:0;font-family:ui-monospace,Menlo,Consolas,"Courier New",monospace;
    font-size:12.5px;line-height:1.55;color:var(--termink);white-space:pre}
  .r{color:var(--red)} .c{color:var(--cyan)} .y{color:var(--yellow)}
  .g{color:var(--green)} .d{color:var(--dim)} .b{font-weight:700}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-top:14px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
  .card h3{margin:0 0 8px;font-size:14px}
  .card p{margin:0;font-size:13px;color:var(--sub)}
  .key{font-family:ui-monospace,Menlo,Consolas,monospace;background:#eef1f4;
    border:1px solid var(--line);border-radius:5px;padding:1px 6px;font-size:12px;color:var(--ink)}
  table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}
  th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line)}
  th{color:var(--sub);font-weight:600;font-size:12px}
  code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px;
    background:#eef1f4;border-radius:4px;padding:1px 5px}
</style>
</head>
<body>
<div class="wrap">
  <h1>dou-cl &nbsp;命令行斗地主 / 跑得快 / 510K</h1>
  <p class="lead">纯终端操作，牌面只用一个字符表示点数，单机可玩也能联网对战。下面是真实运行时的画面。</p>

  <h2>菜单 <span class="cmd">npx dou-cl</span></h2>
  <div class="term"><pre>${monoToHtml(menuText)}</pre></div>

${blocks.map(function (b) {
  return '  <h2>' + b.title + ' <span class="cmd">' + b.cmd + '</span></h2>\n' +
    '  <div class="term"><pre>' + b.html + '</pre></div>\n';
}).join('\n')}

  <h2>联网房间 <span class="cmd">npx dou-cl --create doudizhu</span></h2>
  <div class="term"><pre>${monoToHtml(netText)}</pre></div>

  <h2>牌面表示</h2>
  <table>
    <tr><th>含义</th><th>写法</th></tr>
    <tr><td>点数 3–9</td><td><code>3</code> <code>4</code> <code>5</code> <code>6</code> <code>7</code> <code>8</code> <code>9</code></td></tr>
    <tr><td>10</td><td><code>0</code>（也接受 <code>10</code> / <code>T</code>）</td></tr>
    <tr><td>J / Q / K / A</td><td><code>J</code> <code>Q</code> <code>K</code> <code>A</code></td></tr>
    <tr><td>2</td><td><code>2</code></td></tr>
    <tr><td>小王 / 大王</td><td><code>w</code> / <code>W</code></td></tr>
    <tr><td>花色</td><td><code>♠ ♥ ♣ ♦</code>（<code>--ascii</code> 时为 <code>S H C D</code>；输入可用 <code>s h c d</code>）</td></tr>
  </table>

  <h2>常用操作</h2>
  <div class="cards">
    <div class="card"><h3>出牌</h3><p>直接敲点数：<span class="key">34567</span> 或 <span class="key">3 4 5 6 7</span>；指定花色 <span class="key">5s 5h</span>。要五十K / 同花顺直接敲 <span class="key">50K</span> / <span class="key">56789</span>，程序自动挑同花色那组。</p></div>
    <div class="card"><h3>命令</h3><p><span class="key">p</span> 不要 &nbsp; <span class="key">h</span> 提示 &nbsp; <span class="key">?</span> 帮助 &nbsp; <span class="key">quit</span> 退出</p></div>
    <div class="card"><h3>联网</h3><p>房主 <span class="key">--serve</span>，其他人 <span class="key">--join 地址 --code 房间号</span>，或者 <span class="key">--match 玩法</span> 快速匹配。人数不够由电脑补齐。</p></div>
    <div class="card"><h3>单机</h3><p><span class="key">-g doudizhu</span> / <span class="key">-g paodekuai</span> / <span class="key">-g fivek</span>，<span class="key">--speed 0</span> 可以让电脑飞快出牌。</p></div>
  </div>
</div>
</body>
</html>
`;

const outPath = path.join(__dirname, '..', '预览.html');
fs.writeFileSync(outPath, html, 'utf8');
console.log('已生成 ' + outPath + '（' + html.length + ' 字节）');
