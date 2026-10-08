'use strict';

/**
 * 皮肤：git diff
 * 把状态渲染成一份 YAML，然后和上一帧做**真正的**统一 diff。
 * `+` 行就是当前状态（可以用 patch 直接 apply 回去，是货真价实的 diff）。
 */

const crypto = require('crypto');
const color = require('../color');
const packet = require('./packet');

const FILE = 'src/deck/session.yaml';

function hashOf(text) {
  return crypto.createHash('sha1').update(text, 'utf8').digest('hex').slice(0, 7);
}

/* ---------------- 状态 -> YAML ---------------- */

function toYaml(p, st) {
  const L = [];
  L.push('session:');
  L.push('  pool: ' + st.pool);
  L.push('  seq: ' + st.seq);
  L.push('  game: ' + p.game);
  L.push('  phase: ' + p.phase);
  L.push('  turn: ' + p.turnLabel);
  L.push('  self:');
  L.push('    hand: [' + p.hand.join(', ') + ']');
  L.push('    hold: ' + p.hand.length);
  L.push('  peers:');
  p.peers.forEach(function (x) {
    L.push('    - { id: ' + x.label + ', hold: ' + x.count +
      (x.role ? ', role: ' + x.role : '') + ', out: ' + (x.out ? 'true' : 'false') +
      ', score: ' + x.score + ' }');
  });
  L.push('  table: ' + (p.last
    ? '{ by: ' + p.last.who + ', cards: [' + p.last.cards.join(', ') + '], type: ' + p.last.type + ' }'
    : 'null'));
  if (p.bottom) L.push('  bottom: [' + p.bottom.join(', ') + ']');
  L.push('  recent:');
  if (!p.history.length) L.push('    []');
  else p.history.slice(-7).forEach(function (h) { L.push('    - ' + packet.historyShort(h)); });
  L.push('  result: ' + (p.over ? p.summary : 'null'));
  return L;
}

/* ---------------- 行 diff ---------------- */

function lcsDiff(a, b) {
  const n = a.length, m = b.length;
  const dp = new Array(n + 1);
  for (let i = 0; i <= n; i++) dp[i] = new Int32Array(m + 1);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = (a[i] === b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ t: ' ', s: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: '-', s: a[i] }); i++; }
    else { out.push({ t: '+', s: b[j] }); j++; }
  }
  while (i < n) { out.push({ t: '-', s: a[i] }); i++; }
  while (j < m) { out.push({ t: '+', s: b[j] }); j++; }
  return out;
}

function paint(entry) {
  if (entry.t === '+') return color.c256(114, '+' + entry.s);
  if (entry.t === '-') return color.c256(174, '-' + entry.s);
  return color.dim(' ' + entry.s);
}

/** 只保留变化的行前后各若干行之外的上下文（这里为了好看，全量保留） */
function buildDiff(prevYaml, curYaml, seq) {
  const a = prevYaml;
  const b = curYaml;
  const out = [];
  const newHash = hashOf(b.join('\n'));
  const oldHash = a === null ? '0000000' : hashOf(a.join('\n'));

  out.push(color.dim('$') + ' git diff -U50 -- ' + FILE);
  out.push(color.bold('diff --git a/' + FILE + ' b/' + FILE));
  if (a === null) {
    out.push(color.bold('new file mode 100644'));
    out.push(color.dim('index 0000000..' + newHash));
    out.push(color.bold('--- /dev/null'));
    out.push(color.bold('+++ b/' + FILE));
    out.push(color.cyan('@@ -0,0 +1,' + b.length + ' @@'));
    b.forEach(function (l) { out.push(color.c256(114, '+' + l)); });
    return out;
  }
  out.push(color.dim('index ' + oldHash + '..' + newHash + ' 100644'));
  out.push(color.bold('--- a/' + FILE));
  out.push(color.bold('+++ b/' + FILE));
  out.push(color.cyan('@@ -1,' + a.length + ' +1,' + b.length + ' @@'));
  const d = lcsDiff(a, b);
  d.forEach(function (e) { out.push(paint(e)); });
  return out;
}

module.exports = {
  key: 'diff',
  name: 'git diff',
  desc: '伪装成 YAML 配置的统一 diff，绿色 + 行就是当前牌局（diff 真实可 apply）',
  accent: 114,

  reset: function (st) { st.lastYaml = null; },

  render: function (p, st) {
    const yaml = toYaml(p, st);
    const prev = st.lastYaml === undefined ? null : st.lastYaml;
    const lines = buildDiff(prev, yaml, st.seq);
    const out = [];
    if (st.seq <= 1 || prev === null) {
      out.push(color.dim('$') + ' git status --short');
      out.push(color.c256(174, ' M ' + FILE));
      out.push('');
    }
    out.push.apply(out, lines);
    st.lastYaml = yaml;
    return out.join('\n') + '\n';
  },

  prompt: function () {
    return color.green('dev@ws') + ':' + color.blue('~/svc') + color.gray(' (main)') + '$ ';
  },

  help: function (rules) {
    const out = [];
    out.push(color.dim('# ') + color.bold('deck-sync') + color.dim(' 内部调试工具（勿外传）'));
    out.push('');
    rules.forEach(function (l) { out.push(color.dim('#   ' + l)); });
    out.push('');
    out.push(color.dim('#   出牌 34567 / 3 4 5 6 7    带花色 5s 5h'));
    out.push(color.dim('#   pass | p    hint | h    redraw    reveal    skin <名>    quit'));
    return out.join('\n') + '\n';
  },

  message: function (text) {
    return color.dim('# ' + text) + '\n';
  },
};
