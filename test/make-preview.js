'use strict';

/* 用真实渲染结果生成一个静态预览页 */

const fs = require('fs');
const path = require('path');
const gamesMod = require('../src/games');
const bot = require('../src/bot');
const ui = require('../src/ui');
const skins = require('../src/skins');
const color = require('../src/color');

ui.setAscii(false);
color.setEnabled(true);

/* ---------------- ANSI -> HTML ---------------- */

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

function monoToHtml(s) {
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
        if (codes[0] === 0 && codes.length === 1) {
          st = {};
        } else {
          for (let k = 0; k < codes.length; k++) {
            const c = codes[k];
            if (c === 0) { st = {}; }
            else if (c === 1) st['font-weight'] = '700';
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

/* ---------------- 采样 ---------------- */

function screenFor(key, steps, skin) {
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
  }

  if (skin) {
    // 先把局面推进到人类回合
    let guard = 0;
    while (!st.over && st.turn !== 0 && guard++ < 40) {
      const a = bot.chooseAction(engine, st, st.turn);
      if (!engine.apply(st, st.turn, a).ok) break;
    }
    if (skin === 'diff') {
      // diff 皮肤要有“上一版”才好看：先渲染一帧，再往前走一步
      skins.setKey(skin);
      skins.render(engine.view(st, 0), 0, {});
      guard = 0;
      while (!st.over && st.turn !== 0 && guard++ < 40) {
        const a = bot.chooseAction(engine, st, st.turn);
        if (!engine.apply(st, st.turn, a).ok) break;
      }
    } else {
      skins.setKey(skin);        // 重置会话，让 seq 从 1 开始（命令头 / 首个 JSON 帧才完整）
    }
    const text = skins.render(engine.view(st, 0), 0, {});
    const prompt = skins.prompt();
    skins.setKey('term');
    return text + prompt + '_';
  }

  let guard = 0;
  while (!st.over && st.turn !== 0 && guard++ < 40) {
    const a = bot.chooseAction(engine, st, st.turn);
    if (!engine.apply(st, st.turn, a).ok) break;
  }
  const view = engine.view(st, 0);
  const text = ui.renderTable(view, 0, {});
  const prompt = view.phase === 'bid'
    ? '\n叫分 (0=不叫 1/2/3=叫分, ?=帮助) > _'
    : '\n出牌 (例: 34567 或 5 5 5 6 / p 不要 / h 提示 / ? 帮助) > _';
  return text + (view.over ? '' : prompt);
}

/* ---------------- 页面 ---------------- */

const playSections = [
  { key: 'doudizhu', steps: 4, title: '斗地主', cmd: 'npx dou-cl -g doudizhu' },
  { key: 'paodekuai', steps: 6, title: '跑得快', cmd: 'npx dou-cl -g paodekuai' },
  { key: 'fivek', steps: 7, title: '510K', cmd: 'npx dou-cl -g fivek' },
];

const stealthSections = [
  { key: 'doudizhu', skin: 'log', steps: 6, title: '默认 · 日志流', cmd: 'npx dou-cl -g doudizhu',
    hint: 'tail -f 一个服务日志 &nbsp;·&nbsp; hand[] / peers[] / table= 就是牌局' },
  { key: 'fivek', skin: 'hex', steps: 8, title: '换肤 · hexdump', cmd: 'npx dou-cl --skin hex',
    hint: 'xxd 转储 &nbsp;·&nbsp; hex 是真字节，右边 ASCII 列就是要读的' },
  { key: 'paodekuai', skin: 'json', steps: 8, title: '换肤 · JSON 应答', cmd: 'npx dou-cl --skin json',
    hint: 'WS 帧 + jq 配色 &nbsp;·&nbsp; 去掉颜色就是合法 JSON' },
  { key: 'doudizhu', skin: 'diff', steps: 9, title: '换肤 · git diff', cmd: 'npx dou-cl --skin diff',
    hint: 'YAML 统一 diff &nbsp;·&nbsp; 绿色 + 行是当前牌局，diff 可 apply' },
];

const menuText = [
  '',
  '  dou-cl   v1.0.1',
  '',
  '  ' + '\u2500'.repeat(58),
  '   单机',
  '    1  斗地主  3 人 \u00b7 17 张 + 3 张底牌',
  '    2  跑得快  3 人 \u00b7 一副牌去掉大小王',
  '    3  510K  4 人 \u00b7 两副牌 \u00b7 5/10/K 计分',
  '',
  '   联机（一个 ip:port 就是一个房间）',
  '    4  加入房间         5  开一个房间',
  '',
  '    0  退出',
  '  ' + '\u2500'.repeat(58),
  '   直接回车 = 1（单机斗地主）',
  '',
  '请选择 > _',
].join('\n');

const netText = [
  '',
  '  房间 192.168.1.10:8080   斗地主 \u00b7 3 人',
  '  ' + '\u2500'.repeat(52),
  '   1 号位   你',
  '   2 号位   空 \u00b7 等待加入',
  '   3 号位   空 \u00b7 等待加入',
  '  ' + '\u2500'.repeat(52),
  '   等待玩家 1/3    朋友加入： npx dou-cl --join 192.168.1.10:8080',
  '',
  '[s] 用电脑补齐先开局   [q] 退出 > _',
].join('\n');

const play = playSections.map(function (sec) {
  return { title: sec.title, cmd: sec.cmd, html: monoToHtml(screenFor(sec.key, sec.steps, null)) };
});
const stealth = stealthSections.map(function (sec) {
  return { title: sec.title, cmd: sec.cmd, hint: sec.hint, html: monoToHtml(screenFor(sec.key, sec.steps, sec.skin)) };
});

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>dou-cl 命令行斗地主 · 效果预览</title>
<style>
  :root{
    --bg:#f6f7f9; --card:#fff; --ink:#1c2024; --sub:#666f7a;
    --line:#e3e6ea; --term:#12161c;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
    line-height:1.6;padding:28px 18px 70px}
  .wrap{max-width:980px;margin:0 auto}
  h1{font-size:24px;margin:0 0 6px}
  .lead{color:var(--sub);margin:0 0 10px;font-size:14px}
  h2{font-size:16px;margin:34px 0 6px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  h2 .cmd{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;
    background:#eef1f4;border:1px solid var(--line);border-radius:6px;padding:2px 8px;color:var(--sub);font-weight:400}
  .hint{color:var(--sub);font-size:12.5px;margin:0 0 8px}
  .term{background:var(--term);border-radius:10px;padding:16px 18px;overflow-x:auto}
  .term pre{margin:0;font-family:ui-monospace,Menlo,Consolas,"Courier New",monospace;
    font-size:12.5px;line-height:1.55;color:#c9d1d9;white-space:pre}
  .sep{height:1px;background:var(--line);margin:38px 0 0}
  .badge{display:inline-block;font-size:11px;font-weight:600;letter-spacing:.04em;
    padding:2px 9px;border-radius:999px;background:#fff3d6;color:#8a6116;border:1px solid #f0dcae}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px;margin-top:14px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
  .card h3{margin:0 0 8px;font-size:14px}
  .card p{margin:0;font-size:13px;color:var(--sub)}
  .key{font-family:ui-monospace,Menlo,Consolas,monospace;background:#eef1f4;
    border:1px solid var(--line);border-radius:5px;padding:1px 6px;font-size:12px;color:var(--ink)}
  table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}
  th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
  th{color:var(--sub);font-weight:600;font-size:12px}
  code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px;
    background:#eef1f4;border-radius:4px;padding:1px 5px}
</style>
</head>
<body>
<div class="wrap">
  <h1>dou-cl &nbsp;命令行斗地主 / 跑得快 / 510K</h1>
  <p class="lead">牌面只用一个字符表示点数，单机可玩也能联网。<b>默认就是摸鱼模式</b> —— 全程伪装成正常的开发输出。
  下面是真实运行时的画面。</p>

  <h2>菜单 <span class="cmd">npx dou-cl</span></h2>
  <p class="hint">菜单上只有「玩法」和「是否联机」两件事。想连菜单都不出现，直接 <span class="key">npx dou-cl -g doudizhu</span>。</p>
  <div class="term"><pre>${monoToHtml(menuText)}</pre></div>

  <div class="sep"></div>
  <h2><span class="badge">默认</span> 牌桌就藏在开发输出里</h2>
  <p class="lead">牌桌信息一条都不删 —— 手牌、各家剩几张、谁出的什么、场上最大、轮谁、结果，全都在输出里，
  只是换了一层壳。每个壳都是<b>自洽</b>的：hex 是真字节、JSON 能解析、diff 能 apply。
  随时敲 <span class="key">reveal</span> 看真身，<span class="key">skin &lt;名&gt;</span> 现场换皮肤。</p>

${stealth.map(function (b) {
  return '  <h2>' + b.title + ' <span class="cmd">' + b.cmd + '</span></h2>\n' +
    '  <p class="hint">' + b.hint + '</p>\n' +
    '  <div class="term"><pre>' + b.html + '</pre></div>\n';
}).join('\n')}

  <div class="sep"></div>
  <h2>联网房间 <span class="cmd">npx dou-cl --serve --port 8080</span></h2>
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
    <tr><td>伪装输出里的牌</td><td>点数 + 花色两个字符：<code>3s</code> <code>0h</code> <code>Jd</code> <code>W</code></td></tr>
  </table>

  <h2>常用操作</h2>
  <div class="cards">
    <div class="card"><h3>出牌</h3><p>直接敲点数：<span class="key">34567</span> 或 <span class="key">3 4 5 6 7</span>；指定花色 <span class="key">5s 5h</span>。要五十K / 同花顺直接敲 <span class="key">50K</span> / <span class="key">56789</span>，程序自动挑同花色那组。</p></div>
    <div class="card"><h3>命令</h3><p><span class="key">p</span> 不要 &nbsp; <span class="key">h</span> 提示 &nbsp; <span class="key">?</span> 帮助 &nbsp; <span class="key">quit</span> 退出</p></div>
    <div class="card"><h3>伪装相关</h3><p><span class="key">reveal</span> 看真身 &nbsp; <span class="key">redraw</span> 重画 &nbsp; <span class="key">skin log|hex|json|diff</span> 换皮肤</p></div>
    <div class="card"><h3>联网</h3><p>一个 <span class="key">ip:port</span> 就是一个房间：本机 <span class="key">--serve --port 8080</span>，别人 <span class="key">--join 地址:端口</span>。人满回绝，人不够就等 —— <span class="key">s</span> 让电脑补齐先开局，<span class="key">q</span> 退出。</p></div>
  </div>

  <div class="sep"></div>
  <h2>关掉伪装 <span class="cmd">npx dou-cl --skin term</span></h2>
  <p class="hint">不喜欢伪装的话，可以看回原生牌桌（牌面和上面一样，只是排版是牌桌的样子）。</p>
${play.map(function (b) {
  return '  <h2>' + b.title + ' <span class="cmd">' + b.cmd + '</span></h2>\n' +
    '  <div class="term"><pre>' + b.html + '</pre></div>\n';
}).join('\n')}
</div>
</body>
</html>
`;

const outPath = path.join(__dirname, '..', '预览.html');
fs.writeFileSync(outPath, html, 'utf8');
console.log('已生成 ' + outPath + '（' + html.length + ' 字节）');
