'use strict';

/**
 * 皮肤：xxd 十六进制转储
 * 左边是货真价实的 hex（对得上右边 ASCII 列），右边就是牌局信息。
 * 扫一眼屏幕的人只看到「这人在 dump 一个 log 文件」。
 */

const color = require('../color');
const packet = require('./packet');

const COLS = 24;          // 每行字节数
const GROUP = 4;          // 每 4 字节一组

function two(n) { return n < 10 ? '0' + n : '' + n; }

function stamp(ms) {
  const d = new Date(ms);
  return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + ' ' +
    two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds()) + '.' +
    ('00' + d.getMilliseconds()).slice(-3);
}

/* ---------------- 内容构造（全部 ASCII，字节 = 字符） ---------------- */

function Builder() {
  this.parts = [];
  this.marks = [];
  this.len = 0;
}
Builder.prototype.t = function (s) { this.parts.push(s); this.len += s.length; return this; };
Builder.prototype.m = function (s, cls) {
  const start = this.len;
  this.parts.push(s);
  this.len += s.length;
  this.marks.push({ start: start, end: this.len, cls: cls });
  return this;
};
Builder.prototype.nl = function () { this.parts.push('\n'); this.len += 1; return this; };
Builder.prototype.text = function () { return this.parts.join(''); };

function buildContent(p, st) {
  const b = new Builder();
  const gap = ' ';

  b.t(stamp(st.clock) + ' DEBUG deck.sync      pool=').m(st.pool, 'key').t(' seq=' + st.seq).nl();

  // 一行嘈杂日志，让整段看起来更像真的
  b.t(stamp(st.clock + 1) + ' DEBUG cache.LruCache get key=deck:' + st.pool + ' hit=true ttl=27').nl();

  const turnMark = p.isMyTurn ? '*>' : ' >';
  b.t(stamp(st.clock + 2) + ' INFO  deck.sync      phase=' + p.phase + gap + 'turn=');
  b.m(p.turnLabel + turnMark, 'turn');
  b.nl();

  b.t(stamp(st.clock + 2) + ' INFO  deck.sync      hand[' + p.hand.length + ']=');
  b.m('[' + p.hand.join(' ') + ']', 'hand');
  b.nl();

  b.t(stamp(st.clock + 3) + ' INFO  deck.sync      peers=');
  b.m('[' + p.peers.map(function (s) { return s.label + ':' + s.count; }).join(' ') + ']', 'peer');
  b.nl();

  if (p.last) {
    b.t(stamp(st.clock + 3) + ' INFO  deck.sync      table=');
    b.m(p.last.who + '->[' + p.last.cards.join(' ') + ']', 'table');
    b.t(' ' + p.last.type).nl();
  } else {
    b.t(stamp(st.clock + 3) + ' INFO  deck.sync      table=none (free lead)').nl();
  }

  if (p.bottom) {
    b.t(stamp(st.clock + 4) + ' INFO  deck.sync      bottom=[' + p.bottom.join(' ') + ']').nl();
  }

  p.history.slice(-6).forEach(function (h) {
    b.t(stamp(st.clock + 4) + ' INFO  deck.sync        ' + packet.historyShort(h)).nl();
  });

  if (p.summary) {
    b.t(stamp(st.clock + 5) + ' WARN  deck.sync      result=').m(p.summary, 'table').nl();
  }
  return b;
}

/* ---------------- hexdump ---------------- */

function offsetHex(n) {
  let s = (n >>> 0).toString(16);
  while (s.length < 8) s = '0' + s;
  return s;
}

function classFor(off, marks) {
  for (let i = 0; i < marks.length; i++) {
    if (off >= marks[i].start && off < marks[i].end) return marks[i].cls;
  }
  return null;
}

const PAINT = {
  hand: function (s) { return color.c256(114, s); },
  table: function (s) { return color.c256(179, s); },
  peer: function (s) { return color.c256(110, s); },
  key: function (s) { return color.c256(180, s); },
  turn: function (s) { return color.c256(150, s); },
};

function dump(buf, marks) {
  const lines = [];
  for (let off = 0; off < buf.length; off += COLS) {
    const n = Math.min(COLS, buf.length - off);
    let hex = '';
    for (let i = 0; i < COLS; i += GROUP) {
      let g = '';
      for (let j = 0; j < GROUP; j++) {
        const k = i + j;
        g += (k < n) ? buf.toString('hex', off + k, off + k + 1) : '  ';
      }
      hex += g + ' ';
    }
    hex = hex.replace(/\s+$/, '');

    let asc = '';
    for (let i = 0; i < n; i++) {
      const b = buf[off + i];
      const ch = (b >= 32 && b < 127) ? String.fromCharCode(b) : '.';
      const cls = classFor(off + i, marks);
      asc += (cls && PAINT[cls]) ? PAINT[cls](ch) : ch;
    }
    const width = (COLS / GROUP) * (GROUP * 2 + 1) - 1;
    lines.push(color.gray(offsetHex(off)) + ': ' + color.dim(hex.padEnd(width)) + '  ' + asc);
  }
  return lines.join('\n');
}

module.exports = {
  key: 'hex',
  name: 'hexdump',
  desc: '伪装成 xxd 十六进制转储，右边 ASCII 列就是牌面（hex 与字符严格对应）',
  accent: 114,

  header: function (st) {
    return color.dim('$ xxd -c ' + COLS + ' logs/deck-sync.log');
  },

  render: function (p, st) {
    const b = buildContent(p, st);
    const buf = Buffer.from(b.text(), 'ascii');
    const out = [];
    if (st.seq <= 1) out.push(this.header(st));
    out.push(dump(buf, b.marks));
    return out.join('\n') + '\n';
  },

  prompt: function () {
    return color.green('dev@ws') + ':' + color.blue('~/svc') + '$ ';
  },

  help: function (lines) {
    const out = ['# deck-sync 内部工具（勿外传）', ''];
    lines.forEach(function (l) { out.push('# ' + l); });
    out.push('');
    out.push('#   出牌 直接敲点数        例  34567 或 3 4 5 6 7');
    out.push('#   带花色                      5s 5h 5c 5d');
    out.push('#   不要 pass / p    提示 hint / h    重画 redraw');
    out.push('#   看真身 reveal    换皮肤 skin <名>  退出 quit');
    return out.join('\n') + '\n';
  },

  message: function (text) {
    return '# ' + text + '\n';
  },
};
