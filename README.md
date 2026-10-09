<p align="center">
  <img src="https://raw.githubusercontent.com/iguangyu/dou-cl/main/docs/logo.png" alt="dou-cl" width="782">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dou-cl"><img src="https://img.shields.io/npm/v/dou-cl?color=2ea44f&label=npm" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/dou-cl"><img src="https://img.shields.io/badge/license-MIT-blue" alt="license"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D16-3c873a" alt="node">
</p>

<p align="center"><b>一个伪装成开发控制台的命令行牌桌。</b></p>

跑起来就是一屏正常的开发输出：服务端日志、`xxd` 转储、JSON 帧、git diff。
里面其实是**斗地主 / 跑得快 / 510K**，牌局信息一条不删，只是换了层壳。
工位上扫一眼屏幕的人，只会觉得你在看构建日志。

```bash
npx dou-cl --join 43.159.48.211:10001   # 进公共房间，和真人打
npx dou-cl                              # 单机，电脑陪打
npx dou-cl -g doudizhu                  # 跳过菜单直接开局（最隐蔽）
```

---

## 公共房间

有人开了一台公共服务器：**`43.159.48.211`，端口 `10000`–`12000`，一共 2001 个房间。**

每个端口是一个独立房间，**随便挑一个进去就行** —— 大多数时候里面已经有真人。

```bash
npx dou-cl --join 43.159.48.211:10001
```

- 人不够会一直等着，**人齐了自动开局**；等的时候敲 `s` 让电脑先补上，`q` 退出
- 人满了会直接告诉你（`room full`），**换个端口**再试即可
- 只想自己练手就 `npx dou-cl`，单机三位电脑陪打

---

## 局域网联机

**一个 `ip:port` 就是一个房间**，服务器自己不占座位，只是托管。

```bash
npx dou-cl --serve --port 8080 -g doudizhu   # 本机开一个房间
npx dou-cl --join 192.168.1.10:8080          # 同事连进来，地址就是房间号
npx dou-cl --serve --ports 10000-12000       # 一次开一片，每个端口一个独立房间
```

换皮肤、`reveal` 这类纯本地的操作**任何时刻都能用**，不用等你的回合。

---

## 四种伪装

**`log`（默认）** —— 服务端日志流。看 `hand[...]` / `peers=[...]` / `table=`。

<p align="center">
  <img src="https://raw.githubusercontent.com/iguangyu/dou-cl/main/docs/skin-log.png" alt="日志流" width="753">
</p>

时间戳单调递增，还混着几行无关的噪声日志，整屏就是某个服务在正常打日志。

**`hex`** —— `xxd` 十六进制转储。**只读右边 ASCII 列。**

<p align="center">
  <img src="https://raw.githubusercontent.com/iguangyu/dou-cl/main/docs/skin-hex.png" alt="hexdump" width="567">
</p>

左边是真 hex、跟右列逐字节对应，不是随便编的。

**`json`** —— WS 收到的 JSON 帧。看 `"hand"` / `"peers"` / `"table"`。

<p align="center">
  <img src="https://raw.githubusercontent.com/iguangyu/dou-cl/main/docs/skin-json.png" alt="JSON" width="579">
</p>

去掉颜色就是一份合法 JSON，能直接 `JSON.parse`。

**`diff`** —— YAML 的 git diff。**只读绿色 `+` 行。**

<p align="center">
  <img src="https://raw.githubusercontent.com/iguangyu/dou-cl/main/docs/skin-diff.png" alt="git diff" width="506">
</p>

是真 diff，能 `git apply` 回去；红色 `-` 是上一帧，不用看。

四种壳都是**真货**：hex 逐字节对应、JSON 能解析、diff 能 apply。
输出也全是 **ASCII** —— 不出现中文，玩家名是 `self` / `mei`，角色是 `landlord` / `farmer`，
输入提示符也是伪装的（`dev@ws:~/svc$ `、`node > `、`[tail -f] $ `），敲的 `34567` 看起来就是条命令。

```bash
npx dou-cl --skin hex    # 启动时就换
npx dou-cl --skins       # 列出全部
```

游戏里敲 `skin <名>` 随时换，`reveal` 看一眼原生牌桌，`redraw` 重画一屏。

---

## 操作

牌面**一个字符表示点数**：`3 4 5 6 7 8 9 0(=10) J Q K A 2`，`w`=小王 `W`=大王；花色 `s h c d`。

| 操作 | 写法 |
| --- | --- |
| 出牌 | 直接敲点数：`34567` 或 `3 4 5 6 7`；指定花色 `5s 5h` |
| 不要 / 提示 / 帮助 / 退出 | `p` / `h` / `?` / `q` |
| 看真身 / 换皮肤 / 重画 | `reveal` / `skin <名>` / `redraw` |

同花顺、五十K **不用管花色**，直接敲 `56789` / `50K`，程序自动挑同花色那组。

---

## 三种玩法

| 玩法 | 人数 | 简介 |
| --- | --- | --- |
| **斗地主** | 3 | 叫分 1/2/3 抢地主，拿 3 张底牌；炸弹 / 春天各 ×2 |
| **跑得快** | 3 | 一副牌去大小王，持 ♠3 者先出且首手必带 ♠3 |
| **510K** | 4 | 两副牌，5/10/K 计分；五十K 是通吃牌型 |

---

## License

MIT
