const gamesMod = require('../src/games');
const bot = require('../src/bot');
const skins = require('../src/skins');
const ui = require('../src/ui');

const key = process.argv[2] || 'doudizhu';
const skin = process.argv[3] || 'log';
const steps = Number(process.argv[4] || 6);

const engine = gamesMod.create(key);
const names = ['小美', '阿飞', '老王'];
const players = [{ name: '你', bot: false }];
for (let i = 1; i < engine.rules.seats; i++) players.push({ name: names[i - 1], bot: true });
const st = engine.start(players);
for (let i = 0; i < steps && !st.over; i++) {
  const seat = engine.asker(st);
  if (seat === null) break;
  const a = bot.chooseAction(engine, st, seat);
  if (!engine.apply(st, seat, a).ok) break;
}
skins.setKey(skin);
process.stdout.write(skins.render(engine.view(st, 0), 0, {}));
process.stdout.write(skins.prompt() + '\n');
