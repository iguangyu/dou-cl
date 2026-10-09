'use strict';

/*
 * 训练模式（刻意不写进 README / --help）
 * 入口： dou-cl --exercise          进菜单
 *        dou-cl --exercise count    直接开某一项
 *
 * 四项训练：
 *   count     剩余张数推算 —— 真发牌、逐手滚屏，停下来问你某点数还剩几张没露面
 *   flash     闪现记忆     —— 一组牌显示几秒后清屏，考短期记忆
 *   bestplay  最省跟牌     —— 上家出了一手，找代价最小的那手去管
 *   bid       叫分判断     —— 17 张牌，问你叫几分
 *
 * 输出刻意用简短的英文，跟 --skin 那套一个调子：屏幕上看着像随手写的测试脚本。
 */

const C = require('./core/cards');
const combo = require('./core/combo');
const gamesMod = require('./games');
const bot = require('./bot');
const ui = require('./ui');

const code = require('./skins/packet').cardCode;
const c = ui.colors;
const T = combo.T;
const sleep = ui.sleep;

const DRILLS = ['count', 'flash', 'bestplay', 'bid'];
const DRILL_NAME = {
  count: 'count    剩余张数推算',
  flash: 'flash    闪现记忆',
  bestplay: 'bestplay 最省跟牌',
  bid: 'bid      叫分判断',
};
const DRILL_DESC = {
  count: '真发一副牌逐手滚给你看，停下来问你某个点数还剩几张没露面',
  flash: '一组牌显示几秒后清屏，然后考你刚才看到了什么',
  bestplay: '上家出了一手，让你找「代价最小」的那手去管',
  bid: '一手 17 张，让你判断该叫几分',
};

const ROUNDS = 10;

/* ------------------------------------------------------------------ */
/* 小工具                                                             */
/* ------------------------------------------------------------------ */

const DECK = C.createDeck({ decks: 1, jokers: true });

function ask(io, prompt) {
  return new Promise(function (resolve) {
    io.ask(prompt, function (l) { resolve(String(l).trim()); });
  });
}

function wipe() {
  if (process.env.DOUCL_NO_WIPE) return;      // 自测用
  if (process.stdout.isTTY) process.stdout.write('\u001b[2J\u001b[H');
  else process.stdout.write('\n'.repeat(40));
}

function isQuit(s) {
  return /^(quit|exit|q!|:q)$/i.test(s);
}

function normRank(s) {
  s = String(s).trim().toUpperCase();
  if (s === '10' || s === 'T') return '0';
  return s;
}

function rankText(r) { return C.rankChar(r); }

/** 手牌一律用皮肤那套两个字符的 ASCII 码显示：3s 0h Jd W */
function handCodes(cards) {
  return C.sortHand(cards).map(code).join(' ');
}
function codesOf(cards) {
  return cards.map(code).join(' ');
}

function bar(score, full) {
  const n = Math.max(0, Math.min(24, Math.round(score / full * 24)));
  return c.green('█'.repeat(n)) + c.dim('░'.repeat(24 - n));
}

function verdict(pct) {
  if (pct >= 95) return c.green('solid');
  if (pct >= 75) return c.yellow('ok');
  if (pct >= 45) return c.yellow('shaky');
  return c.red('off');
}

function secs(t) { return (t / 1000).toFixed(1); }

/* ------------------------------------------------------------------ */
/* 发牌 / 滚屏                                                        */
/* ------------------------------------------------------------------ */

function fmtHistory(h) {
  const who = (h.seat === 0 ? 'me' : 'p' + h.seat).padEnd(3);
  switch (h.kind) {
    case 'bid': return '  ' + who + (h.score ? 'bid ' + h.score : c.dim('pass'));
    case 'landlord': return '  ' + who + c.yellow('landlord');
    case 'play': return '  ' + who + 'play  ' + h.cards.map(code).join(' ') +
      '   ' + c.dim('[' + h.type + ']');
    case 'pass': return '  ' + who + c.dim('pass');
    case 'bomb': return '  ' + who + c.red('bomb x2');
    case 'score': return '  ' + who + c.yellow('+' + h.points);
    default: return '';
  }
}

/** 发一副斗地主，先摊叫分/底牌，再逐手滚屏到指定手数 */
async function streamDeal(io, pace, moves) {
  const engine = gamesMod.create('doudizhu');
  const players = [{ name: 'me', bot: true }, { name: 'p1', bot: true }, { name: 'p2', bot: true }];

  let state = null;
  let tries = 0;
  do {
    state = engine.start(players);
    let g = 0;
    while (state.phase === 'bid' && !state.over && g++ < 20) {
      engine.apply(state, state.turn, bot.chooseAction(engine, state, state.turn));
    }
    tries++;
  } while (state.over && tries < 6);
  if (state.over) return null;

  state.history.forEach(function (h) {
    const line = fmtHistory(h);
    if (line) io.say(line);
  });
  if (state.bottomRevealed) {
    io.say('  ' + c.dim('bottom  ') + state.bottom.map(code).join(' '));
  }
  io.say('');
  io.say('  ' + c.dim('-- streaming --'));
  io.say('');

  for (let i = 0; i < moves && !state.over; i++) {
    const s = engine.asker(state);
    if (s === null || s === undefined) break;
    const before = state.history.length;
    engine.apply(state, s, bot.chooseAction(engine, state, s));
    for (let k = before; k < state.history.length; k++) {
      const line = fmtHistory(state.history[k]);
      if (line) io.say(line);
    }
    await sleep(pace);
  }
  return { engine: engine, state: state };
}

/* ------------------------------------------------------------------ */
/* 1. count —— 剩余张数推算                                           */
/* ------------------------------------------------------------------ */

/** 排掉「自己手上 + 已经打出去的 + 底牌」之后，这个点数还有几张没露面 */
function hiddenOf(state, rank) {
  const seen = new Set();
  state.seats[0].hand.forEach(function (x) { seen.add(x.id); });
  state.history.forEach(function (h) {
    if (h.kind === 'play' && h.cards) h.cards.forEach(function (x) { seen.add(x.id); });
  });
  if (state.bottomRevealed) state.bottom.forEach(function (x) { seen.add(x.id); });

  let total = 0, shown = 0;
  DECK.forEach(function (x) {
    if (x.r !== rank) return;
    total++;
    if (seen.has(x.id)) shown++;
  });
  return { total: total, shown: shown, hidden: total - shown };
}

async function drillCount(io, opts, n) {
  const pace = Math.min(Math.max(opts.speed || 700, 150), 2000);
  let score = 0, full = 0, ms = 0;

  for (let r = 1; r <= n; r++) {
    io.say('');
    io.say(c.bold('  ── ' + r + ' / ' + n + ' ─────────────────────────'));
    const fed = await streamDeal(io, pace, 9 + Math.floor(Math.random() * 12));
    if (!fed) { io.say(c.red('  deal failed, skip')); continue; }
    const state = fed.state;

    // 挑一个「必须盯着出牌过程才答得出」的点数：
    //   至少有一张被打出来过（逼你记流水），且外面确实还有没露面的（答案不平凡）
    const playedCount = {};
    state.history.forEach(function (h) {
      if (h.kind === 'play' && h.cards) {
        h.cards.forEach(function (x) { playedCount[x.r] = (playedCount[x.r] || 0) + 1; });
      }
    });
    const pool = [];
    for (let rank = 3; rank <= 17; rank++) {
      if (!playedCount[rank]) continue;
      if (hiddenOf(state, rank).hidden < 1) continue;
      pool.push(rank);
    }
    pool.sort(function (a, b) { return playedCount[b] - playedCount[a]; });
    const top = pool.slice(0, Math.max(3, Math.ceil(pool.length / 2)));
    const rank = top.length ? top[Math.floor(Math.random() * top.length)]
      : (3 + Math.floor(Math.random() * 13));
    const ans = hiddenOf(state, rank);

    io.say('');
    io.say('  ' + c.dim('hand ') + handCodes(state.seats[0].hand));
    io.say('');
    io.say('  ' + c.cyan('Q') + '  rank ' + c.bold(rankText(rank)) +
      ': how many are still ' + c.bold('unseen') + ' ?');
    io.say('     ' + c.dim('( = total - yours - played - bottom )'));
    const t0 = Date.now();
    const line = await ask(io, '  > ');
    if (isQuit(line)) return null;
    const used = Date.now() - t0;
    ms += used;

    const got = parseInt(line, 10);
    const ok = got === ans.hidden;
    const s = ok ? 100 : 20;
    score += s; full += 100;

    io.say('  ' + (ok ? c.green('OK') : c.red('NG')) +
      c.dim('   ' + secs(used) + 's') +
      (ok ? '' : '   you=' + got + ' ans=' + ans.hidden));
    io.say('     ' + c.dim('check:') + ' total ' + ans.total +
      ' - seen ' + ans.shown + ' = ' + c.bold(String(ans.hidden)));

    const playedList = [];
    state.history.forEach(function (h) {
      if (h.kind === 'play' && h.cards) {
        h.cards.forEach(function (x) { if (x.r === rank) playedList.push(code(x)); });
      }
    });
    const mine = state.seats[0].hand.filter(function (x) { return x.r === rank; }).map(code);
    const bottom = state.bottomRevealed
      ? state.bottom.filter(function (x) { return x.r === rank; }).map(code) : [];
    io.say('     ' + c.dim('seen:') +
      ' yours[' + (mine.join(' ') || '-') + ']' +
      ' played[' + (playedList.join(' ') || '-') + ']' +
      ' bottom[' + (bottom.join(' ') || '-') + ']');
  }

  return { score: score, full: full, ms: ms, name: 'count' };
}

/* ------------------------------------------------------------------ */
/* 2. flash —— 闪现记忆                                               */
/* ------------------------------------------------------------------ */

function flashQuestions(list) {
  const qs = [];

  const red = list.filter(function (x) { return x.s === 1 || x.s === 3; }).length;
  qs.push({
    hard: false,
    q: 'how many were hearts or diamonds?',
    check: function (s) {
      return { ok: parseInt(s, 10) === red, ans: String(red) };
    },
  });

  const jokers = list.filter(function (x) { return x.r >= 16; }).map(code);
  qs.push({
    hard: false,
    q: 'any joker in the list? (y/n)',
    check: function (s) {
      return { ok: /^y/i.test(s) === (jokers.length > 0), ans: jokers.length ? jokers.join(' ') : 'none' };
    },
  });

  const k = 1 + Math.floor(Math.random() * list.length);
  const target = list[k - 1];
  qs.push({
    hard: true,
    q: 'what was card #' + k + ' (left to right)?',
    check: function (s) {
      return { ok: !!ui.parseCardInput(s, [target]).ok, ans: code(target) };
    },
  });

  let maxR = 0;
  list.forEach(function (x) { if (x.r > maxR) maxR = x.r; });
  qs.push({
    hard: true,
    q: 'highest rank in the list? (rank only)',
    check: function (s) {
      return { ok: normRank(s) === rankText(maxR).toUpperCase(), ans: rankText(maxR) };
    },
  });

  const cnt = {};
  list.forEach(function (x) { cnt[x.r] = (cnt[x.r] || 0) + 1; });
  const pairs = Object.keys(cnt).filter(function (rr) { return cnt[rr] >= 2; });
  qs.push({
    hard: true,
    q: 'any two cards of the same rank? (y/n)',
    check: function (s) {
      return {
        ok: /^y/i.test(s) === (pairs.length > 0),
        ans: pairs.length ? pairs.map(function (rr) { return rankText(Number(rr)); }).join(' ') : 'none',
      };
    },
  });

  const easy = qs.filter(function (q) { return !q.hard; });
  const hard = qs.filter(function (q) { return q.hard; });
  return [
    easy[Math.floor(Math.random() * easy.length)],
    hard[Math.floor(Math.random() * hard.length)],
  ].filter(Boolean);
}

async function drillFlash(io, opts, n) {
  const hold = opts.speed >= 1000 ? opts.speed : 4000;
  const size = 7;
  let score = 0, full = 0, ms = 0;

  for (let r = 1; r <= n; r++) {
    wipe();
    const list = C.shuffle(C.createDeck({ decks: 1, jokers: true })).slice(0, size);
    io.say('');
    io.say('  ' + c.bold('── ' + r + ' / ' + n + ' ──') + c.dim('   memorize ' + size +
      ' cards, ' + (hold / 1000).toFixed(1) + 's'));
    io.say('');
    io.say('    ' + list.map(function (x) { return c.bold(code(x)); }).join('   '));
    io.say('');
    await sleep(hold);

    const qs = flashQuestions(list);
    const answers = [];
    wipe();
    io.say('');
    io.say('  ' + c.bold('── ' + r + ' / ' + n + ' ──'));
    io.say('');
    for (let i = 0; i < qs.length; i++) {
      const t0 = Date.now();
      const line = await ask(io, '  ' + c.cyan('Q') + ' ' + qs[i].q + '  > ');
      if (isQuit(line)) return null;
      const used = Date.now() - t0;
      ms += used;
      const res = qs[i].check(line);
      score += res.ok ? 100 : 0;
      full += 100;
      answers.push({ q: qs[i], res: res, line: line });
    }
    io.say('');
    io.say('  list:  ' + list.map(code).join('   '));
    answers.forEach(function (a) {
      io.say('   ' + (a.res.ok ? c.green('OK') : c.red('NG')) + ' ' + a.q.q +
        c.dim('  -> ' + a.res.ans) + (a.res.ok ? '' : c.dim('   you=' + a.line)));
    });
    io.say('');
  }
  return { score: score, full: full, ms: ms, name: 'flash' };
}

/* ------------------------------------------------------------------ */
/* 3. bestplay —— 找最省的一手                                        */
/* ------------------------------------------------------------------ */

/**
 * 代价公式（题目里会写出来，判分透明）：
 *   cost = main * 2 - len * 2 + (bomb/rocket ? 100 : 0)
 * 点数越小、出得越多，代价越低。
 */
function followCost(cards, co) {
  let v = co.main * 2 - cards.length * 2;
  if (co.type === T.BOMB || co.type === T.ROCKET) v += 100;
  return v;
}

function makeScenario(rules) {
  for (let attempt = 0; attempt < 120; attempt++) {
    const deck = C.shuffle(C.createDeck({ decks: 1, jokers: true }));
    const handSize = 10 + Math.floor(Math.random() * 5);
    const hand = deck.slice(0, handSize);
    const rest = deck.slice(handSize);
    const grp = C.groupByRank(rest);
    const kind = ['single', 'pair', 'trio1', 'trio2', 'straight'][Math.floor(Math.random() * 5)];
    const ranks = [];
    grp.forEach(function (v, k) { ranks.push(k); });
    ranks.sort(function (a, b) { return a - b; });

    let cards = null;
    if (kind === 'single') {
      const r = ranks[Math.floor(Math.random() * ranks.length)];
      cards = [grp.get(r)[0]];
    } else if (kind === 'pair') {
      const pool = ranks.filter(function (r) { return grp.get(r).length >= 2; });
      if (pool.length) { const r = pool[Math.floor(Math.random() * pool.length)]; cards = grp.get(r).slice(0, 2); }
    } else if (kind === 'trio1' || kind === 'trio2') {
      const pool = ranks.filter(function (r) { return grp.get(r).length >= 3; });
      if (pool.length) {
        const r = pool[Math.floor(Math.random() * pool.length)];
        const body = grp.get(r).slice(0, 3);
        let wing = null;
        if (kind === 'trio1') {
          const w = ranks.filter(function (x) { return x !== r; });
          if (w.length) wing = [grp.get(w[Math.floor(Math.random() * w.length)])[0]];
        } else {
          const w = ranks.filter(function (x) { return x !== r && grp.get(x).length >= 2; });
          if (w.length) wing = grp.get(w[Math.floor(Math.random() * w.length)]).slice(0, 2);
        }
        if (wing) cards = body.concat(wing);
      }
    } else {
      const seq = ranks.filter(function (r) { return r >= 3 && r <= 14; });
      for (let i = 0; i + 5 <= seq.length; i++) {
        if (seq[i + 4] === seq[i] + 4) {
          cards = [];
          for (let k = 0; k < 5; k++) cards.push(grp.get(seq[i + k])[0]);
          break;
        }
      }
    }
    if (!cards) continue;
    const co = combo.analyze(cards, rules);
    if (!co) continue;
    const beats = combo.findBeats(hand, co, rules);
    // 至少得有两个选择才值得问（只有一个答案的题没意思）
    if (beats.length < 2) continue;
    return { hand: hand, target: { cards: cards, combo: co }, beats: beats };
  }
  return null;
}

async function drillBestplay(io, opts, n) {
  const rules = require('./core/rules').DOUDIZHU;
  let score = 0, full = 0, ms = 0;

  for (let r = 1; r <= n; r++) {
    const sc = makeScenario(rules);
    if (!sc) { io.say(c.red('  scenario failed, skip')); continue; }

    const scored = sc.beats.map(function (b) {
      return { b: b, cost: followCost(b.cards, b.combo) };
    }).sort(function (a, b) { return a.cost - b.cost; });
    const best = scored[0].cost;

    io.say('');
    io.say(c.bold('  ── ' + r + ' / ' + n + ' ─────────────────────────'));
    io.say('  ' + c.dim('hand(' + sc.hand.length + ') ') + handCodes(sc.hand));
    io.say('  ' + c.yellow('p1 played') + '  ' + sc.target.cards.map(code).join(' ') +
      '   ' + c.dim('[' + sc.target.combo.type + ']'));
    io.say('  ' + c.dim('cost = main*2 - len*2 + (bomb/rocket?100:0)   input cards, or p'));
    const t0 = Date.now();
    const line = await ask(io, '  > ');
    if (isQuit(line)) return null;
    const used = Date.now() - t0;
    ms += used;

    let got = null, err = null;
    if (/^p$|^pass$|^不要$/i.test(line)) {
      got = { type: 'pass' };
    } else {
      const parsed = ui.parseCardInput(line, sc.hand);
      if (!parsed.ok) err = parsed.err;
      else {
        const cards = sc.hand.filter(function (x) { return parsed.ids.indexOf(x.id) >= 0; });
        const co = combo.analyze(cards, rules);
        if (!co) err = 'not a valid combo';
        else if (!combo.canBeat(co, sc.target.combo, rules)) err = 'cannot beat it';
        else got = { type: 'play', cards: cards, co: co };
      }
    }

    let s;
    io.say('');
    if (err) {
      s = 0;
      io.say('  ' + c.red('NG ' + err));
    } else if (got.type === 'pass') {
      s = 0;
      io.say('  ' + c.red('NG') + c.dim('  you can beat it — the task asks for the cheapest beat'));
    } else {
      const cost = followCost(got.cards, got.co);
      const gap = cost - best;
      if (gap === 0) { s = 100; io.say('  ' + c.green('OK cheapest')); }
      else if (gap <= 3) { s = 80; io.say('  ' + c.yellow('close') + c.dim('  +' + gap + ' cost')); }
      else if (gap <= 8) { s = 50; io.say('  ' + c.yellow('wasteful') + c.dim('  +' + gap + ' cost')); }
      else { s = 20; io.say('  ' + c.red('too costly') + c.dim('  +' + gap)); }
      io.say('     yours: ' + codesOf(got.cards) + '   cost ' + cost);
    }
    score += s; full += 100;

    io.say('     ' + c.dim('cheapest options:'));
    scored.slice(0, 3).forEach(function (x, i) {
      io.say('      ' + (i === 0 ? c.green('*') : ' ') + ' ' +
        x.b.cards.map(code).join(' ') + '  ' + c.dim('[' + x.b.combo.type + ']') +
        '   cost ' + x.cost);
    });
    io.say('     ' + c.dim('score ' + s + '/100   ' + secs(used) + 's'));
  }
  return { score: score, full: full, ms: ms, name: 'bestplay' };
}

/* ------------------------------------------------------------------ */
/* 4. bid —— 叫分判断                                                 */
/* ------------------------------------------------------------------ */

function strengthDetail(hand) {
  const grp = C.groupByRank(hand);
  const cnt = function (r) { return (grp.get(r) || []).length; };
  const parts = [];
  let s = 0;

  if (cnt(17)) { s += cnt(17) * 6; parts.push('big joker x' + cnt(17) + '  +' + cnt(17) * 6); }
  if (cnt(16)) { s += cnt(16) * 5; parts.push('small joker x' + cnt(16) + '  +' + cnt(16) * 5); }
  if (cnt(15)) { s += cnt(15) * 2.5; parts.push('2 x' + cnt(15) + '  +' + (cnt(15) * 2.5)); }
  if (cnt(14)) { s += cnt(14) * 1; parts.push('A x' + cnt(14) + '  +' + cnt(14)); }

  let bombs = 0, trios = 0;
  grp.forEach(function (v) {
    if (v.length === 4) bombs++;
    else if (v.length === 3) trios++;
  });
  if (bombs) { s += bombs * 6; parts.push('bomb x' + bombs + '  +' + bombs * 6); }
  if (trios) { s += trios * 0.5; parts.push('trio x' + trios + '  +' + (trios * 0.5)); }
  if (cnt(16) >= 1 && cnt(17) >= 1) { s += 6; parts.push('rocket  +6'); }

  let run = 0, runBonus = 0;
  for (let r = 3; r <= 14; r++) {
    if (grp.has(r)) { run++; if (run >= 5) runBonus += 0.4; } else run = 0;
  }
  if (runBonus) { s += runBonus; parts.push('straight potential  +' + runBonus.toFixed(1)); }

  const ref = s >= 13 ? 3 : (s >= 8.5 ? 2 : (s >= 5 ? 1 : 0));
  return { score: s, parts: parts, ref: ref };
}

async function drillBid(io, opts, n) {
  let score = 0, full = 0, ms = 0;

  for (let r = 1; r <= n; r++) {
    const deck = C.shuffle(C.createDeck({ decks: 1, jokers: true }));
    const hand = C.sortHand(deck.slice(0, 17));
    const detail = strengthDetail(hand);

    io.say('');
    io.say(c.bold('  ── ' + r + ' / ' + n + ' ─────────────────────────'));
    io.say('  ' + c.dim('17 cards ') + handCodes(hand));
    io.say('  ' + c.dim('bid?  0=pass  1/2/3'));
    const t0 = Date.now();
    const line = await ask(io, '  > ');
    if (isQuit(line)) return null;
    const used = Date.now() - t0;
    ms += used;

    const v = parseInt(line, 10);
    if (isNaN(v) || v < 0 || v > 3) { io.say(c.red('  0/1/2/3 only')); continue; }

    const gap = Math.abs(v - detail.ref);
    const s = gap === 0 ? 100 : (gap === 1 ? 60 : 20);
    score += s; full += 100;

    io.say('');
    io.say('  ' + (gap === 0 ? c.green('OK') : c.yellow('NG')) +
      c.dim('   ref=' + detail.ref + '   ' + secs(used) + 's'));
    io.say('     strength ' + c.bold(detail.score.toFixed(1)) +
      c.dim('   (>=13 -> 3, >=8.5 -> 2, >=5 -> 1, else pass)'));
    if (detail.parts.length) detail.parts.forEach(function (p) { io.say('      ' + c.dim(p)); });
    else io.say('      ' + c.dim('(all scattered)'));
  }
  return { score: score, full: full, ms: ms, name: 'bid' };
}

/* ------------------------------------------------------------------ */
/* 汇总 / 菜单                                                        */
/* ------------------------------------------------------------------ */

function summary(io, res) {
  if (!res) return;
  io.say('');
  io.say('  ' + c.bold('summary') + c.dim('   ' + res.name));
  const pct = res.full ? res.score / res.full * 100 : 0;
  io.say('  ' + bar(pct, 100) + '  ' + pct.toFixed(0) + '%  ' + verdict(pct));
  io.say('  ' + c.dim('score ' + res.score + '/' + res.full + '   ' + (res.ms / 1000).toFixed(0) + 's total'));
  io.say('');
}

async function runOne(io, opts, key) {
  io.say('');
  io.say('  ' + c.bold(DRILL_NAME[key]) + c.dim('   x ' + ROUNDS + ' questions'));
  io.say('  ' + c.dim(DRILL_DESC[key]));
  io.say('  ' + c.dim('type quit anytime to leave this drill'));
  io.say('');
  await ask(io, '  enter to start > ');

  let res = null;
  if (key === 'count') res = await drillCount(io, opts, ROUNDS);
  else if (key === 'flash') res = await drillFlash(io, opts, ROUNDS);
  else if (key === 'bestplay') res = await drillBestplay(io, opts, ROUNDS);
  else if (key === 'bid') res = await drillBid(io, opts, ROUNDS);
  summary(io, res);
  return res;
}

const MENU = [
  ['1', 'count', 'count', 'remaining-card audit'],
  ['2', 'flash', 'flash', 'short-term memory'],
  ['3', 'bestplay', 'bestplay', 'cheapest beat'],
  ['4', 'bid', 'bid', 'opening bid'],
  ['5', 'mixed', 'mixed', 'random mix of the above'],
  ['0', null, 'exit', ''],
];

function showMenu(io, opts) {
  io.say('');
  io.say('  ' + c.bold('drill') + c.dim('    card codes are the same: 3s 0h Jd W'));
  io.say('  ' + '\u2500'.repeat(52));
  MENU.forEach(function (m) {
    io.say('   ' + c.bold(m[0]) + '  ' + m[2].padEnd(9) + (m[3] ? c.dim(m[3]) : ''));
  });
  io.say('  ' + '\u2500'.repeat(52));
  io.say('');
  io.ask(' pick > ', function (line) {
    const s = (line || '').trim().toLowerCase();
    if (s === '0' || s === 'quit' || s === 'exit') {
      io.say('  bye.');
      io.close();
      return;
    }
    let key = null;
    const byNum = MENU.filter(function (m) { return m[0] === s; })[0];
    if (byNum) key = byNum[1];
    if (!key && (DRILLS.indexOf(s) >= 0 || s === 'mixed')) key = s;
    if (!key) { io.say(c.red('  no such drill')); return showMenu(io, opts); }
    play(io, opts, key).then(function () { showMenu(io, opts); })
      .catch(function (e) { io.say(c.red('  error: ' + e.message)); showMenu(io, opts); });
  });
}

async function play(io, opts, key) {
  if (key === 'mixed') {
    const seq = [];
    for (let i = 0; i < 4; i++) seq.push(DRILLS[Math.floor(Math.random() * DRILLS.length)]);
    io.say('');
    io.say('  ' + c.bold('mixed') + c.dim('   ' + seq.join(' -> ')));
    let score = 0, full = 0, ms = 0;
    for (let i = 0; i < seq.length; i++) {
      const res = await runOne(io, opts, seq[i]);
      if (!res) return;
      score += res.score; full += res.full; ms += res.ms;
    }
    summary(io, { score: score, full: full, ms: ms, name: 'mixed' });
    return;
  }
  await runOne(io, opts, key);
}

/**
 * 入口
 * @param io    已创建的 ui.IO
 * @param opts  命令行选项（用到 speed）
 * @param which 'menu' 或具体项目名
 */
async function run(io, opts, which) {
  if (!which || which === 'menu') return showMenu(io, opts);
  await play(io, opts, which);
  return showMenu(io, opts);
}

module.exports = {
  run: run,
  DRILLS: DRILLS,
  DRILL_NAME: DRILL_NAME,
  // 给自测用
  _internals: {
    count: drillCount,
    flash: drillFlash,
    bestplay: drillBestplay,
    bid: drillBid,
    hiddenOf: hiddenOf,
    makeScenario: makeScenario,
    strengthDetail: strengthDetail,
    followCost: followCost,
  },
};
