'use strict';

/* 让电脑互相打 N 局，检查规则引擎有没有漏洞 */

const gamesMod = require('../src/games');
const bot = require('../src/bot');
const runner = require('../src/runner');
const comboMod = require('../src/core/combo');

const N = Number(process.argv[2] || 300);

async function playOne(key, dump) {
  const engine = gamesMod.create(key);
  const rules = engine.rules;
  const players = [];
  for (let s = 0; s < rules.seats; s++) players.push({ name: 'P' + s, bot: true });

  let state;
  let tries = 0;
  do {
    state = await runner.runDeal(engine, players,
      async function (st, seat) { return bot.chooseAction(engine, st, seat); },
      null,
      {
        onReject: function (err, seat) {
          throw new Error('非法动作被拒绝 err=' + err + ' seat=' + seat +
            ' turn=' + state.turn + ' phase=' + state.phase + ' last=' +
            (state.last ? state.last.combo.type : 'none') + ' hand=' +
            state.seats[seat].hand.map(function (c) { return c.r + (c.s >= 0 ? c.s : ''); }).join(','));
        },
      });
    state = state;
    tries++;
  } while (state.result && state.result.type === 'redeal' && tries < 20);
  return state;
}

async function main() {
  let bad = 0;
  for (const key of gamesMod.keys) {
    const rules = gamesMod.create(key).rules;
    const winSeats = new Array(rules.seats).fill(0);
    const typeCount = {};
    let totalCardsOk = true;
    const t0 = Date.now();
    for (let i = 0; i < N; i++) {
      let state;
      try {
        state = await playOne(key, false);
      } catch (e) {
        bad++;
        console.error('[' + key + '] 第 ' + i + ' 局出错: ' + e.message);
        if (bad > 5) { console.error('错误太多，停止。'); process.exit(1); }
        continue;
      }
      // 检查：每家用掉的牌 + 手里的牌 == 起始牌数（+底牌）
      const expect = [];
      state.seats.forEach(function (s, idx) {
        const played = [];
        state.history.forEach(function (h) {
          if (h.kind === 'play' && h.seat === idx) h.cards.forEach(function (c) { played.push(c); });
        });
        const total = played.length + s.hand.length;
        let base = rules.handSize;
        if (key === 'doudizhu' && state.extra.landlord === idx) base += rules.bottom;
        if (total !== base) {
          console.error('[' + key + '] 座位 ' + idx + ' 牌数不对: 打过 ' + played.length +
            ' + 手里 ' + s.hand.length + ' = ' + total + '，应为 ' + base);
          totalCardsOk = false;
        }
      });
      state.history.forEach(function (h) {
        if (h.kind === 'play' && h.type) typeCount[h.type] = (typeCount[h.type] || 0) + 1;
      });
      if (state.result && state.result.seat !== undefined) winSeats[state.result.seat]++;
      else if (state.result && state.result.winner === 'landlord') winSeats[state.extra.landlord]++;
    }
    const dt = Date.now() - t0;
    console.log('[' + key + '] ' + N + ' 局完成  ' + dt + 'ms  (' + Math.round(dt / N) + 'ms/局)  ' +
      '胜者分布 ' + JSON.stringify(winSeats) + '  牌数校验 ' + (totalCardsOk ? 'OK' : '失败'));
    console.log('        出牌类型: ' + JSON.stringify(typeCount));
  }
  if (bad) { console.log('共 ' + bad + ' 局异常'); process.exit(1); }
  console.log('\n全部通过。');
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
