'use strict';

/* 把训练模式的真实输出打出来看（测试用，不参与 npm 打包） */

process.env.DOUCL_NO_WIPE = '1';
const ex = require('../src/exercise');
const I = ex._internals;

const which = process.argv[2] || 'count';
const rounds = Number(process.argv[3] || 1);

function stub(answers) {
  let i = 0;
  return {
    handler: null,
    clear: function () {},
    block: function () {},
    close: function () {},
    say: function (t) { process.stdout.write(String(t) + '\n'); },
    ask: function (prompt, handler) {
      const a = answers[Math.min(i, answers.length - 1)];
      i++;
      process.stdout.write(prompt + a + '\n');
      setImmediate(function () { handler(a); });
    },
  };
}

const ANS = {
  count: ['1', '2', '0', '1'],
  flash: ['3', 'y', 'Jd', 'A', 'y'],
  bestplay: ['p', 'p'],
  bid: ['2', '1'],
};

I[which](stub(ANS[which] || ['1']), { speed: 150 }, rounds)
  .then(function () { process.exit(0); })
  .catch(function (e) { console.error(e); process.exit(1); });
