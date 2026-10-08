# dou-cl 🃏

命令行牌桌 —— **斗地主 / 跑得快 / 510K**，纯终端操作，单机可玩，也能联网对战。

**摸鱼模式**：整个牌桌伪装成看起来正常的开发输出（日志流 / xxd 转储 / JSON 帧 / git diff），
信息一条不删，只是换了层壳 —— 工位上扫一眼屏幕的人只会觉得你在看构建日志。
菜单上只有两件事要选：**玩什么** 和 **单机还是联机**。
详见 [三、牌桌藏在开发输出里](#三牌桌藏在开发输出里默认)。

牌面只用一个字符表示点数，不搞花哨的 ASCII 画图：

```
点数： 3 4 5 6 7 8 9 0(=10) J Q K A 2   w=小王   W=大王
花色： ♠ ♥ ♣ ♦          （--ascii 就会变成 S H C D）
```

---

## 一、跑起来

```bash
# 进菜单：只选玩法和是否联机
npx dou-cl

# 跳过菜单直接开一局（最隐蔽，屏幕上不会闪出任何“游戏”字样）
npx dou-cl -g doudizhu      # 斗地主
npx dou-cl -g paodekuai     # 跑得快
npx dou-cl -g fivek         # 510K

# 本地源码方式（没发布 npm 也照样用）
node bin/dou-cl.js
npm link        # 之后直接敲 dou-cl
npx .           # 在项目目录里用 npx 跑
```

> 从别人那里拿到这个目录时，先 `npm install`（只有 `ws` 一个依赖，联网用；不装也能单机玩）。

---

## 二、操作

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

- 想要同花顺或五十K 时，**不用管花色**，直接敲 `56789` / `50K`，程序会自动挑同一花色那组。
- 花色字母：`s`=♠ `h`=♥ `c`=♣ `d`=♦。
- 电脑出牌有约 0.7 秒间隔，用 `--speed 0` 可以飞快跳过。

---

## 三、牌桌藏在开发输出里（默认）

给工位上玩的人准备的：**牌局信息一条都不删，只换一层壳**。

```bash
npx dou-cl                        # 默认皮肤就是 log（日志流）
npx dou-cl --skin hex             # 换皮肤： log / hex / json / diff
npx dou-cl --skin term            # 关掉伪装，显示原生牌桌
npx dou-cl --skins                # 列皮肤
```

游戏里敲 `skin <名>` 可以随时换，`reveal` 可以临时看一眼真身。

### 四种壳

| 皮肤 | 长什么样 | 自洽性 |
| --- | --- | --- |
| `log`（默认） | 服务端结构化日志（`tail -f` 的感觉），牌就是日志字段 | 时间戳单调递增，混了无关噪声行 |
| `hex` | `xxd -c 24` 十六进制转储，右边 ASCII 列就是牌 | **左边 hex 与右边字符严格逐字节对应** |
| `json` | WS 帧 + jq 风格配色 | **去掉颜色就是合法 JSON，能直接 `JSON.parse`** |
| `diff` | YAML 的统一 diff，绿色 `+` 行是当前牌局 | **是真 diff，能 apply 回去得到当前状态** |

关于「信息没丢」这件事 —— 四种壳里都有：

```
你的手牌       hand[]  / "hand": [...]  /   hand: [...]
各家剩几张     peers=[mei:12 fei:8]    /  "peers": [{ "hold": 12 }]
谁出的什么     history 里的 play/pass 行
场上最大       table=mei->[5s 5h 5d 6c] trio1
轮到谁         turn=self
底牌/分数      bottom= [...] base= / 结果在 result= 行
```

其它细节：

- **不清屏**，像真的日志流一样往下追加（`--skin term` 才清屏）。
- 输出**纯 ASCII**，不出现中文，`hex` 的 ASCII 列也不会变成一串 `.`。
- 玩家名会 ASCII 化（你 → `self`，小美 → `mei`），角色是 `landlord` / `farmer`。
- 输入提示符也是伪装的（`dev@ws:~/svc$ `、`node > `、`[tail -f] $ `），你敲的 `34567` 看起来就是条命令。

---

## 四、联网

三种玩法都支持联网。房主开服务器，其他人连进来；人数不够的位置由电脑补上。

```bash
# 1. 一个人当服务器（局域网内直连）
npx dou-cl --serve --port 8080

# 2. 开房间（连到自己或别人的服务器）
npx dou-cl --create doudizhu --server 192.168.1.10:8080

# 3. 别人加进来
npx dou-cl --join 192.168.1.10:8080 --code ABCD

# 或者快速匹配（服务器自动凑桌）
npx dou-cl --match doudizhu --server 192.168.1.10:8080
```

参数说明：

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

**公网**：把服务器放到有公网 IP 的机器 / 云主机上跑 `npx dou-cl --serve`，大家用 `--server <公网IP>:8080`。服务端是**权威端**，所有牌局逻辑在服务器上跑，客户端只收自己的手牌，改前端看不到别人的牌。

几个实现上的说明：

- 房间 4 位房间号不会重复，房间空了自动回收。
- 中途断线会被电脑托管，不会卡住别人。
- 轮到你了不动手，90 秒后自动帮你出一张（可在代码里改 `turnTimeout`）。

---

## 五、玩法

### 斗地主
- 3 人，每人 17 张，留 3 张底牌。
- 依次叫分 1/2/3 或不叫，最高分当地主并拿走底牌；三家都不叫则流局重发。
- 牌型：单张、对子、三张、三带一、三带二、顺子（5 张起）、连对（3 对起）、飞机（带单/带对）、四带二、四带两对、炸弹、王炸。
- 胜负：地主先出完 → 地主赢；任一农民先出完 → 农民赢。
- 计分：底分 × 倍数，每个炸弹/王炸 ×2，春天 ×2。

### 跑得快
- 3 人，一副牌**去掉大小王**共 52 张，每人 17 张，剩 1 张废弃。
- 首手：持有 ♠3 的玩家先出，且第一手必须带上 ♠3。
- 牌型：和斗地主一样，但**没有王炸**，连对 2 对即可。
- 胜负：谁先出完谁赢，其他人按剩余张数扣分。

### 510K
- 4 人，**两副牌**共 108 张，每人 27 张，没有底牌。
- 牌型：单张、对子、三张、顺子（5 张起）、连对（2 对起）、飞机、**同花顺**、**五十K**、炸弹（4 张及以上同点）、王炸。
- **五十K**（同花色的 5·10·K 各一张）是通吃牌型：除炸弹和王炸外，**可以压任何牌型**；同花五十K 之间比花色（♠ > ♥ > ♣ > ♦）。
- **同花顺**可以压同长度的普通顺子。
- 计分：5 = 5 分，10 = 10 分，K = 10 分，两副共 200 分。**每一轮结束时，本轮桌面上的分牌全部归本轮最后出牌的人。**
- 胜负：谁先出完手牌谁赢，分数作为副榜。

---

## 六、目录结构

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
test/sim.js             电脑互打自测
test/smoke.js           渲染 / 输入解析 / 联网全流程
test/local-test.js      本地视角回归（人类手牌不能被看错）
test/skins-test.js      伪装皮肤自洽性（hex 对字节 / JSON 可解析 / diff 可 apply / 纯 ASCII）
test/make-preview.js    生成 预览.html
test/show.js            单看某个皮肤的效果： node test/show.js fivek hex 8
```

自测：

```bash
node test/sim.js 300       # 每种玩法各打 300 局电脑互打，校验规则与牌数守恒
node test/smoke.js         # 渲染 / 输入解析 / 服务器+客户端联网打完整一局
node test/local-test.js    # 本地对局：渲染视角必须固定在人类座位上
node test/skins-test.js    # 伪装皮肤：hex 逐字节、JSON 可解析、diff 可 apply、输出纯 ASCII
npm test                   # 以上全部
npm run preview            # 生成 预览.html，先看看跑起来长什么样
```

---

## 七、加新玩法 / 加新皮肤

**加玩法**：在 `src/core/rules.js` 里加一份规则（座位数、牌堆、最小顺子长度、有没有王炸/五十K……），
再写一个继承 `src/games/base.js` 的类实现 `setupPhase` / `checkOver` / `onGameEnd`，
最后在 `src/games/index.js` 注册即可 —— 牌型识别、AI、联网、伪装皮肤全都不用动。

**加伪装皮肤**：在 `src/skins/` 下加一个模块，导出
`{ key, name, desc, render(p, st), prompt(), help(lines), message(text) }`，
其中 `p` 是 `packet.build()` 出来的标准状态包（手牌 / 各家张数 / 桌上最大 / 历史 / 结果都已经在里面），
在 `src/skins/index.js` 的 `LIST` 里注册一行就完事了。

## License

MIT

想把它发到 npm 让别的机器 `npx dou-cl` 直接用？看 [PUBLISH.md](PUBLISH.md)。
