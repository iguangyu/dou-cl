<p align="center">
  <img src="https://raw.githubusercontent.com/iguangyu/dou-cl/main/docs/logo.png" alt="dou-cl" width="782">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dou-cl"><img src="https://img.shields.io/npm/v/dou-cl?color=2ea44f&label=npm" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/dou-cl"><img src="https://img.shields.io/npm/dm/dou-cl?color=4cb7d8" alt="downloads"></a>
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="license">
  <img src="https://img.shields.io/badge/node-%3E%3D16-3c873a" alt="node">
  <img src="https://img.shields.io/badge/dependencies-1%20(ws)-informational" alt="dependencies">
</p>

**命令行斗地主 / 跑得快 / 510K。** 一条 `npx dou-cl` 开一局，单机有电脑陪打，也能联网对战。

**默认就是摸鱼模式** —— 整个牌桌伪装成看起来正常的开发输出（服务端日志 / xxd 转储 / JSON 帧 / git diff）。
牌局信息**一条不删**：手牌、各家剩几张、谁出的什么、场上最大、轮谁、底牌、分数，全都在里面，
只是换了一层壳。工位上扫一眼屏幕的人，只会觉得你在看构建日志。

```bash
npx dou-cl              # 进菜单：只选「玩什么」和「单机还是联机」
npx dou-cl -g doudizhu  # 跳过菜单直接开一局（屏幕上不闪任何「游戏」字样）
```

---

## 目录

- [一、跑起来](#一跑起来)
- [二、牌面与操作](#二牌面与操作)
- [三、隐藏牌桌（默认）](#三隐藏牌桌默认)
- [四、联网](#四联网)
- [五、玩法](#五玩法)
- [六、项目结构](#六项目结构)
- [七、扩展](#七扩展)

---

## 一、跑起来

```bash
# 最省事：进菜单
npx dou-cl

# 跳过菜单，直接开局（最隐蔽）
npx dou-cl -g doudizhu      # 斗地主
npx dou-cl -g paodekuai     # 跑得快
npx dou-cl -g fivek         # 510K

# 从源码跑（没发布也能用）
git clone https://github.com/iguangyu/dou-cl && cd dou-cl && npm install
node bin/dou-cl.js
npm link                    # 之后直接敲 dou-cl
```

<p align="center">
  <img src="https://raw.githubusercontent.com/iguangyu/dou-cl/main/docs/menu.png" alt="dou-cl 菜单" width="496">
</p>

> 只有一个运行时依赖 `ws`（联网用）。不装也能单机玩。

---

## 二、牌面与操作

牌面**只用一个字符表示点数**，不搞花哨的 ASCII 画图：

```
点数： 3 4 5 6 7 8 9 0(=10) J Q K A 2   w=小王   W=大王
花色： ♠ ♥ ♣ ♦          （--ascii 会变成 S H C D）
```

| 操作 | 写法 |
| --- | --- |
| 出牌 | 直接敲点数：`34567` 或 `3 4 5 6 7` |
| 指定花色 | 点数后面接花色：`5s 5h 5c`、`10h`、`Wh` |
| 不要 | `p` 或 `pass` |
| 提示 | `h` 或 `hint` |
| 看真身 | `reveal`（临时打印一次原生牌桌） |
| 换皮肤 | `skin log` / `skin hex` / `skin json` / `skin diff` / `skin term` |
| 重置画面 | `redraw` |
| 帮助 | `?` |
| 退出 | `quit` |

几个小细节：

- 想要同花顺或五十K 时**不用管花色**，直接敲 `56789` / `50K`，程序会自动挑同一花色那组。
- 花色字母：`s`=♠ `h`=♥ `c`=♣ `d`=♦。
- 电脑出牌有约 0.7 秒间隔，`--speed 0` 可以飞快跳过。

嫌伪装麻烦的话加 `--skin term`，就是普通牌桌的样子：

<p align="center">
  <img src="https://raw.githubusercontent.com/iguangyu/dou-cl/main/docs/table.png" alt="原生牌桌" width="567">
</p>

---

## 三、隐藏牌桌（默认）

### 为什么

命令行打牌的多半是程序员，目的就是**神不知鬼不觉地摸鱼**。
所以这个项目的默认状态不是「牌桌」，而是**一屏看起来完全正常的开发输出**。

### 原则：信息一条不删，只换壳

每个「皮肤」都要把下面这些**全部**表达出来，只是表达方式不同：

```
你的手牌       hand[]  / "hand": [...]  /   hand: [...]
各家剩几张     peers=[mei:12 fei:8]    /  "peers": [{ "hold": 12 }]
谁出的什么     history 里的 play / pass 行
场上最大       table=mei->[5s 5h 5d 6c] trio1
轮到谁         turn=self
底牌 / 分数    bottom= [...]  base=      结果在 result= 行
```

### 四种壳，以及「看哪里」

| 皮肤 | 长什么样 | **你要看哪一列 / 哪个字段** |
| --- | --- | --- |
| `log`（默认） | 服务端结构化日志，`tail -f` 的感觉 | `hand[...]` / `peers=[...]` / `table=` 这几个字段 |
| `hex` | `xxd -c 24` 十六进制转储 | **只读右边 ASCII 列**，左边 hex 忽略 |
| `json` | WS 收到的 JSON 帧，jq 风格配色 | `"hand"` 数组 / `"peers"` / `"table"` |
| `diff` | YAML 的统一 diff | **只读绿色 `+` 行**，红色 `-` 是上一帧 |

#### `log` —— 服务端日志流

<p align="center">
  <img src="https://raw.githubusercontent.com/iguangyu/dou-cl/main/docs/skin-log.png" alt="日志流皮肤" width="953">
</p>

时间戳单调递增，还混了几行完全无关的噪声日志（缓存命中、指标上报），
所以整屏看起来就是某个服务在正常打日志。

#### `hex` —— xxd 十六进制转储

<p align="center">
  <img src="https://raw.githubusercontent.com/iguangyu/dou-cl/main/docs/skin-hex.png" alt="hexdump 皮肤" width="717">
</p>

**左边是真 hex** —— 和右边 ASCII 列严格逐字节对应，不是随便编的。
你要做的就是**只读右列**，从上往下一行一行接下去读，就是完整的日志内容。

#### `json` —— WS 帧 + jq 配色

<p align="center">
  <img src="https://raw.githubusercontent.com/iguangyu/dou-cl/main/docs/skin-json.png" alt="JSON 皮肤" width="732">
</p>

**去掉颜色就是一份合法 JSON**，可以直接丢给 `jq` 或 `JSON.parse`。

#### `diff` —— git diff

<p align="center">
  <img src="https://raw.githubusercontent.com/iguangyu/dou-cl/main/docs/skin-diff.png" alt="git diff 皮肤" width="640">
</p>

把状态渲染成一份 YAML，再和上一帧做**真正的统一 diff**。
**绿色 `+` 行就是当前牌局**，红色 `-` 是上一帧，不用看。
顺手还能学个 Git：这个 diff 是能 `git apply` 回去的。

### 每个壳都「自洽」，不是糊弄

这不是把文字换个前缀就完事，每种壳都得经得起盯着看：

| 皮肤 | 保证 |
| --- | --- |
| `hex` | 左边 hex 与右边字符**逐字节对应**；偏移量按 24 递增；部分行按 `xxd` 的规矩补空格对齐 |
| `json` | 去掉 ANSI 颜色后**能直接 `JSON.parse`**，字段值与真实牌局一一对得上 |
| `diff` | **是真 diff** —— 应用后正好等于当前状态，能 `git apply` |
| 全部 | 输出**纯 ASCII**：不出现中文，`hex` 的 ASCII 列也不会变成一串 `.` |

最后一条是硬约束。中文会让 `hex` 的 ASCII 列变成 `.`，也会露马脚。所以摸鱼模式下：

- 玩家名会 **ASCII 化**（你 → `self`，小美 → `mei`）
- 角色名是 `landlord` / `farmer`
- 输入提示符也是伪装的（`dev@ws:~/svc$ `、`node > `、`[tail -f] $ `），你敲的 `34567` 看起来就是条命令
- **不清屏**，像真日志一样往下追加（`--skin term` 才清屏）

这些保证都有测试盯着（见 [项目结构](#六项目结构) 里的 `test/skins-test.js`）。

### 换皮肤

```bash
npx dou-cl --skin hex      # 启动时就换
npx dou-cl --skins         # 列出所有皮肤
```

游戏里敲 `skin <名>` 随时换，`reveal` 临时看一眼真身，`redraw` 重画一屏。

---

## 四、联网

三种玩法都支持联网。房主开服务器，其他人连进来；人数不够的位置由电脑补上。

```bash
# 1. 一个人当服务器（局域网直连）
npx dou-cl --serve --port 8080

# 2. 开房间
npx dou-cl --create doudizhu --server 192.168.1.10:8080

# 3. 别人加进来
npx dou-cl --join 192.168.1.10:8080 --code ABCD

# 或者快速匹配（服务器自动凑桌，凑不满用电脑补）
npx dou-cl --match doudizhu --server 192.168.1.10:8080
```

<p align="center">
  <img src="https://raw.githubusercontent.com/iguangyu/dou-cl/main/docs/net.png" alt="联网房间" width="435">
</p>

| 参数 | 作用 |
| --- | --- |
| `--serve [--port N]` | 在本机起服务器，默认端口 8080 |
| `--create <玩法>` | 连服务器并创建一个房间（会打印 4 位房间号） |
| `--join <地址> [--code XXXX]` | 加入房间 |
| `--match <玩法>` | 快速匹配 |
| `--server <地址>` | 服务器地址，也可用环境变量 `DOUCL_SERVER` |
| `--name <昵称>` | 显示的名字 |
| `--skin <名>` | 换伪装皮肤，`term` = 原生牌桌（也可用 `DOUCL_SKIN`） |

**局域网**：直接 `--serve`，把本机 IP（`ipconfig` 里那个 192.168.x.x）告诉朋友即可。

**公网**：把服务器放到有公网 IP 的机器 / 云主机上跑 `npx dou-cl --serve`，大家用 `--server <公网IP>:8080`。

实现上的几个点：

- **服务端权威**：牌局逻辑全跑在服务器上，客户端只收到自己那手牌和公开信息，改前端看不到别人的牌。
- 房间号 4 位、不重复，房间空了自动回收。
- 中途断线会被电脑托管，不会卡住别人。
- 轮到你了不动手，90 秒后自动帮你出一张。

---

## 五、玩法

### 斗地主

- 3 人，每人 17 张，留 3 张底牌。
- 依次叫分 1/2/3 或不叫，最高分当地主并拿走底牌；三家都不叫则流局重发。
- 牌型：单张、对子、三张、三带一、三带二、顺子（5 张起）、连对（3 对起）、飞机（带单/带对）、四带二、四带两对、炸弹、王炸。
- 胜负：地主先出完 → 地主赢；任一农民先出完 → 农民赢。
- 计分：底分 × 倍数，每个炸弹 / 王炸 ×2，春天 ×2。

### 跑得快

- 3 人，一副牌**去掉大小王**共 52 张，每人 17 张，剩 1 张废弃。
- 首手：持有 ♠3 的玩家先出，且第一手必须带上 ♠3。
- 牌型：和斗地主一样，但**没有王炸**，连对 2 对即可。
- 胜负：谁先出完谁赢，其他人按剩余张数扣分。

### 510K

- 4 人，**两副牌**共 108 张，每人 27 张，没有底牌。
- 牌型：单张、对子、三张、顺子（5 张起）、连对（2 对起）、飞机、**同花顺**、**五十K**、炸弹（4 张及以上同点）、王炸。
- **五十K**（同花色的 5·10·K 各一张）是通吃牌型：除炸弹和王炸外**可以压任何牌型**；同花五十K 之间比花色（♠ > ♥ > ♣ > ♦）。
- **同花顺**可以压同长度的普通顺子。
- 计分：5 = 5 分，10 = 10 分，K = 10 分，两副共 200 分。**每一轮结束时，本轮桌面上的分牌全部归本轮最后出牌的人。**
- 胜负：谁先出完手牌谁赢，分数作为副榜。

---

## 六、项目结构

```
bin/dou-cl.js           命令行入口（参数解析）
src/core/cards.js       牌模型 / 发牌 / 排序
src/core/combo.js       牌型识别、比大小、候选生成
src/core/rules.js       三种玩法的规则开关
src/games/base.js       通用回合引擎（校验与执行分离）
src/games/doudizhu.js   斗地主（叫分 / 春天 / 计分）
src/games/paodekuai.js  跑得快（♠3 先手）
src/games/fivek.js      510K（收分 / 五十K）
src/bot.js              电脑 AI
src/ui.js               渲染 + 输入解析
src/color.js            颜色（原生与伪装皮肤共用）
src/runner.js           单局循环
src/skins/packet.js     把视野压成与渲染方式无关的状态包
src/skins/log.js        伪装皮肤：日志流
src/skins/hex.js        伪装皮肤：xxd 十六进制转储
src/skins/json.js       伪装皮肤：JSON 帧
src/skins/diff.js       伪装皮肤：git diff
src/skins/index.js      皮肤注册表 + 会话状态
src/net/server.js       房间服务器（权威端）
src/net/client.js       联网客户端
tools/make-docs.js      生成 README 配图（用真实渲染器 + Chrome 无头截图）
docs/*.png              README 配图
```

自测：

```bash
npm test                   # 全量：规则 + 渲染 + 联网 + 伪装皮肤自洽性
node test/sim.js 300       # 每种玩法各打 300 局电脑互打，校验规则与牌数守恒
node test/smoke.js         # 渲染 / 输入解析 / 服务器+客户端联网打完整一局
node test/local-test.js    # 本地对局：渲染视角必须固定在人类座位上
node test/skins-test.js    # 伪装皮肤：hex 逐字节、JSON 可解析、diff 可 apply、输出纯 ASCII
npm run preview            # 生成 预览.html
```

---

## 七、扩展

**加玩法**：在 `src/core/rules.js` 里加一份规则（座位数、牌堆、最小顺子长度、有没有王炸/五十K……），
再写一个继承 `src/games/base.js` 的类实现 `setupPhase` / `checkOver` / `onGameEnd`，
最后在 `src/games/index.js` 注册即可 —— 牌型识别、AI、联网、伪装皮肤**全都不用动**。

**加伪装皮肤**：在 `src/skins/` 下加一个模块，导出
`{ key, name, desc, render(p, st), prompt(), help(lines), message(text) }`，
其中 `p` 是 `packet.build()` 出来的标准状态包（手牌 / 各家张数 / 桌上最大 / 历史 / 结果都已经在里面），
在 `src/skins/index.js` 的 `LIST` 里注册一行就完事。

---

## License

MIT