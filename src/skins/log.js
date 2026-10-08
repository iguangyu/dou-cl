'use strict';

/**
 * 皮肤：应用日志流（tail -f 的感觉）
 * 一行一条结构化日志，牌局信息就是日志字段本身。
 */

const color = require('../color');
const packet = require('./packet');

function two(n) { return n < 10 ? '0' + n : '' + n; }

function stamp(ms) {
  const d = new Date(ms);
  return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + ' ' +
    two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds()) + '.' +
    ('00' + d.getMilliseconds()).slice(-3);
}

const LVL = {
  DEBUG: function (s) { return color.gray(s.padEnd(5)); },
  INFO: function (s) { return color.green(s.padEnd(5)); },
  WARN: function (s) { return color.yellow(s.padEnd(5)); },
  ERROR: function (s) { return color.red(s.padEnd(5)); },
};

function line(ts, lvl, logger, msg) {
  return color.gray(stamp(ts)) + ' ' + LVL[lvl](lvl) + ' ' +
    color.dim('[' + 'pool-3-thread-2'.padEnd(14) + ']') + ' ' +
    color.cyan(logger.padEnd(26)) + ' ' + msg;
}

const LG = 'c.acme.deck.SyncService';

module.exports = {
  key: 'log',
  name: '日志流',
  desc: '伪装成服务端结构化日志（tail -f），状态就在日志字段里',
  accent: 114,

  header: function () { return null; },

  render: function (p, st) {
    const out = [];
    const t = st.clock;

    // 噪声：几行无关的常规日志
    out.push(line(t - 3, 'DEBUG', 'c.acme.cache.LruCache', 'get key=deck:' + st.pool + ' hit=true ttl=27'));
    out.push(line(t - 2, 'DEBUG', 'c.acme.metrics.Meter', 'flush points=128 cost=1ms'));

    out.push(line(t, 'INFO', LG,
      'pool=' + color.c256(180, st.pool) + ' seq=' + st.seq + ' event=state.sync'));
    out.push(line(t, 'INFO', LG,
      'phase=' + p.phase + ' turn=' + color.c256(150, p.turnLabel) + (p.isMyTurn ? ' self=pending' : ' self=idle')));

    out.push(line(t + 1, 'INFO', LG,
      'hand[' + p.hand.length + ']=' + color.c256(114, '[' + p.hand.join(' ') + ']')));

    out.push(line(t + 1, 'INFO', LG,
      'peers=' + color.c256(110, '[' + p.peers.map(function (s) {
        return s.label + ':' + s.count + (s.role ? '/' + s.role : '') + (s.out ? '/out' : '');
      }).join(' ') + ']')));

    if (p.last) {
      out.push(line(t + 2, 'INFO', LG,
        'table=' + color.c256(179, p.last.who + '->[' + p.last.cards.join(' ') + ']') +
        ' type=' + p.last.type + ' cards=' + p.last.count));
    } else {
      out.push(line(t + 2, 'INFO', LG, 'table=none freeLead=true'));
    }

    if (p.bottom) {
      out.push(line(t + 2, 'INFO', LG, 'bottom=' + color.c256(179, '[' + p.bottom.join(' ') + ']')));
    }
    if (p.baseScore) {
      out.push(line(t + 2, 'INFO', LG, 'base=' + p.baseScore + ' multiplier=x' + p.multiplier));
    }

    p.history.slice(-7).forEach(function (h, i) {
      out.push(line(t + 2, 'INFO', LG + '$Replay', '  ' + packet.historyShort(h)));
    });

    if (p.over) {
      out.push(line(t + 3, 'WARN', LG, 'result=' + color.c256(179, p.summary)));
      out.push(line(t + 3, 'INFO', LG, 'session closed, waiting for next round'));
    }
    out.push(line(t + 4, 'DEBUG', 'c.acme.metrics.Meter', 'flush points=' + (64 + (st.seq % 7) * 3) + ' cost=1ms'));

    return out.join('\n') + '\n';
  },

  prompt: function () {
    return color.gray('[' + 'tail -f') + '] ' + color.bold('$ ') ;
  },

  help: function (lines) {
    const out = [];
    out.push(color.dim('# 本地调试用 deck-sync，对外没启用'));
    out.push('');
    lines.forEach(function (l) { out.push(color.dim('#   ' + l)); });
    out.push('');
    out.push(color.dim('#   出牌 34567 / 3 4 5 6 7    带花色 5s 5h'));
    out.push(color.dim('#   pass | p   不要      hint | h   提示      redraw   重画'));
    out.push(color.dim('#   reveal   看真身      skin <名>   换皮肤    quit   退出'));
    return out.join('\n') + '\n';
  },

  message: function (text) {
    return line(Date.now(), 'INFO', 'c.acme.deck.SyncService', color.dim(String(text))) + '\n';
  },
};
