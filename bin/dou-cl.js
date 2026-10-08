#!/usr/bin/env node
'use strict';

/*
 * dou-cl —— 命令行斗地主 / 跑得快 / 510K
 * 单机可玩，也支持联网（自建服务器 / 局域网 / 快速匹配）
 */

const path = require('path');
const pkg = require(path.join(__dirname, '..', 'package.json'));

const rulesMod = require('../src/core/rules');
const gamesMod = require('../src/games');
const ui = require('../src/ui');
const app = require('../src/app');

const colors = ui.colors;

function usage() {
  console.log('');
  console.log(colors.bold('  dou-cl  v' + pkg.version) + colors.dim('   命令行斗地主 / 跑得快 / 510K'));
  console.log('');
  console.log(colors.bold('  用法'));
  console.log('    npx dou-cl                        进菜单（最简单的用法）');
  console.log('    npx dou-cl -g doudizhu            直接开一局单机斗地主');
  console.log('    npx dou-cl -g paodekuai           单机跑得快');
  console.log('    npx dou-cl -g fivek               单机 510K');
  console.log('');
  console.log(colors.bold('  联网'));
  console.log('    npx dou-cl --serve                在本机 8080 端口开服务器');
  console.log('    npx dou-cl --serve --port 9000    指定端口');
  console.log('    npx dou-cl --create doudizhu      连服务器并开一个房间');
  console.log('    npx dou-cl --join 1.2.3.4:8080 --code ABCD');
  console.log('    npx dou-cl --match doudizhu --server 1.2.3.4:8080   快速匹配');
  console.log('');
  console.log(colors.bold('  其他'));
  console.log('    --name <昵称>    联网时显示的名字');
  console.log('    --speed <毫秒>   单机电脑出牌间隔（默认 700）');
  console.log('    --ascii          花色用 S/H/C/D 字母显示（老终端兼容）');
  console.log('    -h, --help       显示帮助');
  console.log('    -v, --version    显示版本');
  console.log('');
  console.log(colors.bold('  牌面表示'));
  console.log('    3 4 5 6 7 8 9 0(=10) J Q K A 2   w=小王   W=大王');
  console.log('    花色：♠ ♥ ♣ ♦（--ascii 时为 S H C D）');
  console.log('');
  console.log(colors.bold('  玩法'));
  gamesMod.keys.forEach(function (k) {
    const r = rulesMod.get(k);
    console.log('    ' + r.name + colors.dim('  ' + r.tagline));
  });
  console.log('');
}

function parseArgs(argv) {
  const o = {
    mode: 'menu',
    game: null,
    server: process.env.DOUCL_SERVER || '127.0.0.1:8080',
    code: null,
    name: process.env.DOUCL_NAME || null,
    port: Number(process.env.DOUCL_PORT) || 8080,
    speed: 700,
    ascii: false,
    help: false,
    version: false,
  };
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = function () { return args[++i]; };
    switch (a) {
      case '-h': case '--help': o.help = true; break;
      case '-v': case '--version': o.version = true; break;
      case '--serve': case '--server-mode': o.mode = 'serve'; break;
      case '--join': o.mode = 'join'; o.server = next(); break;
      case '--match': o.mode = 'match'; o.game = next(); break;
      case '--create': o.mode = 'create'; o.game = next(); break;
      case '--local': o.mode = 'local'; o.game = next(); break;
      case '-g': case '--game': o.mode = 'local'; o.game = next(); break;
      case '--server': o.server = next(); break;
      case '--code': o.code = (next() || '').toUpperCase(); break;
      case '--name': o.name = next(); break;
      case '--port': o.port = Number(next()) || 8080; break;
      case '--speed': o.speed = Number(next()) || 700; break;
      case '--ascii': o.ascii = true; break;
      case '--no-color': process.env.NO_COLOR = '1'; break;
      default:
        if (a && a[0] !== '-') {
          if (gamesMod.keys.indexOf(a) >= 0) { o.mode = 'local'; o.game = a; }
        }
    }
  }
  if (o.game && gamesMod.keys.indexOf(o.game) < 0) {
    console.error('未知玩法：' + o.game + '（可选：' + gamesMod.keys.join(', ') + '）');
    process.exit(1);
  }
  if (o.speed < 0) o.speed = 0;
  return o;
}

async function main() {
  const opts = parseArgs(process.argv);
  ui.setAscii(opts.ascii);

  if (opts.help) { usage(); return; }
  if (opts.version) { console.log(pkg.version); return; }

  if (opts.mode === 'serve') {
    const server = require('../src/net/server');
    const s = server.createServer({ port: opts.port });
    console.log(colors.bold('  dou-cl 服务器运行中') + colors.dim('  端口 ' + opts.port));
    console.log(colors.dim('  Ctrl+C 停止'));
    return;
  }

  if (opts.mode === 'create' || opts.mode === 'join' || opts.mode === 'match') {
    const client = require('../src/net/client');
    const io = new ui.IO();
    if (opts.mode === 'join' && !opts.code) {
      const code = await app.ask(io, ' 房间号（4 位）> ');
      opts.code = code.toUpperCase();
    }
    if (opts.mode === 'create' && !opts.game) opts.game = 'doudizhu';
    if (opts.mode === 'match' && !opts.game) opts.game = 'doudizhu';
    if (!opts.name) {
      const n = await app.ask(io, ' 你的昵称 > ');
      opts.name = n || '玩家';
    }
    await client.runClient(io, {
      mode: opts.mode,
      game: opts.game,
      code: opts.code,
      name: opts.name,
      server: opts.server,
    }, opts);
    return;
  }

  const io = new ui.IO();
  io.onClose = function () { process.exit(0); };

  if (opts.mode === 'local') {
    await app.playLocal(io, opts.game, opts);
    app.showMenu(io, opts);
    return;
  }

  app.showMenu(io, opts);
}

main().catch(function (e) {
  console.error(colors.red('运行出错: ' + (e && e.stack || e)));
  process.exit(1);
});
