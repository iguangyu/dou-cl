# 发布到 npm —— 让别人的机器 `npx dou-cl` 直接开玩

> 本文只讲怎么把这个包发上 npm。玩法说明看 [README.md](README.md)。

---

## 0. 先说名字：`dou-cli` 已经被占了

你要的 `npx dou-cli` 用不了，因为 npm 上已经有这个包：

```
dou-cli@1.0.12
author: Andoni Arbulu Lozano <andoni.arbulu@digitalonus.com>
maintainers: andoni-arb, richardhern
last modified: 2022-04-29
description: A simple cli for creating and setting up projects ... [Digital On Us]
```

是家美国公司 2022 年发的脚手架工具，虽然早就没人维护了，但包名还是人家的。
npm 没有"抢名字"的正规途径（除非走商标争议，不值当）。

**所以用 `dou-cl`**，这名字是空的，而且正好是这个仓库的名字，一样短：

| 方案 | 别人怎么运行 | 说明 |
| --- | --- | --- |
| **`dou-cl`（推荐）** | `npx dou-cl` | 名字已确认空闲，和仓库同名 |
| 带 scope | `npx @iguangyu/dou-cli` | 一定能用，但每次要多敲一截 |
| `doucli` | `npx doucli` | 也空闲，但少个连字符看着怪 |

`package.json` 里现在就是 `"name": "dou-cl"`，`bin` 里也有 `dou-cl`，所以发上去就是 `npx dou-cl`。

---

## 1. 一次性准备

### 1.1 注册 npm 账号

没有账号就去 <https://www.npmjs.com/signup> 注册。注册完**去邮箱点验证链接**，
没验证的账号发布时会报 `E403`。

### 1.2 登录（注意要指向官方源）

你这台机器默认 registry 是淘宝镜像，所以**登录必须显式指定官方源**：

```bash
npm login --registry=https://registry.npmjs.org/
# Username / Password / Email / 一次性验证码(如果开了 2FA)
npm whoami --registry=https://registry.npmjs.org/     # 能打印出用户名就成功了
```

> token 会写进 `~/.npmrc`，并且**只对 npmjs 生效** —— 你平时 `npm i` 还是走淘宝镜像，不受影响。

**发布目标已经在 `package.json` 里锁死了**，不用你每次加参数：

```json
"publishConfig": { "registry": "https://registry.npmjs.org/", "access": "public" }
```

---

## 2. 发布（两条命令）

```bash
cd C:\Users\lgy\WorkBuddy\Dou_CL

npm publish --dry-run     # 先干跑一遍：列文件、算体积，不会真发
npm publish               # 真发
```

`--dry-run` 应该看到这样的输出（已经验证过）：

```
npm notice name: dou-cl
npm notice version: 1.0.0
npm notice package size: 46.3 kB
npm notice unpacked size: 150.3 kB
npm notice total files: 25
npm notice Publishing to https://registry.npmjs.org/ with tag latest and public access (dry-run)
+ dou-cl@1.0.0
```

注意 `Publishing to https://registry.npmjs.org/` 这行 —— 说明 `publishConfig` 生效了，
没跑到淘宝镜像上去。

真发的时候会自动先跑测试（`prepublishOnly` → `npm test`，80 条断言）。
**测试挂了就不会发出去**，这是故意的。

如果是开了 2FA 的账号，`npm publish` 会多问一次 `This operation requires a one-time password:`，
输手机/验证器上那个 6 位数。

---

## 3. 别人怎么玩

发完之后，**任何装了 Node 16+ 的机器**，一行就够：

```bash
npx dou-cl
```

第一次会下载（46 kB，加上 `ws` 依赖也就 100 KB 出头），之后走 npx 缓存。

常用几种：

```bash
npx dou-cl -g doudizhu                        # 跳过菜单，直接开一局（最隐蔽）
npx dou-cl -g fivek                           # 510K
npx dou-cl --skin hex                         # 换个伪装皮肤
npx dou-cl --serve --port 8080                # 当服务器，别人连你
npx dou-cl --join 192.168.1.10:8080 --code ABCD
npx dou-cl --match doudizhu --server 1.2.3.4:8080
```

### ⚠️ 刚发完可能拉不到

如果对方的 npm 也配了淘宝镜像（npmmirror），**镜像同步有几分钟到几十分钟延迟**，
刚发布立刻 `npx dou-cl` 可能 404。两个办法：

```bash
# 立刻能用的写法，绕开镜像
npx --registry=https://registry.npmjs.org/ dou-cl

# 或者直接等几分钟再试
npx dou-cl
```

---

## 4. 以后更新版本

改完代码，**必须升版本号**再发，否则 npm 会报 `EPUBLISHCONFLICT` / `E403`：

```bash
npm version patch    # 1.0.0 → 1.0.1   修 bug
npm version minor    # 1.0.0 → 1.1.0   加功能
npm version major    # 1.0.0 → 2.0.0   不兼容改动

npm publish
```

`npm version` 会自动改 `package.json`、打一个 git tag（`v1.0.1`）、并提交。
顺手把 tag 推上去，GitHub 上就能看到版本：

```bash
git push --follow-tags
```

---

## 5. 常见错误对照

| 报错 | 原因 / 怎么办 |
| --- | --- |
| `E403 ... you must be logged in` | 没登录。`npm login --registry=https://registry.npmjs.org/` |
| `E403 ... verify your email` | 账号邮箱没验证，去邮箱点链接 |
| `E403 You do not have permission to publish "dou-cli"` | 名字被占用（就是本文第 0 节那事）。换名或改 `package.json` 的 `name` |
| `EPUBLISHCONFLICT` / `cannot publish over the previously published versions` | 版本号没升。`npm version patch` |
| `EOTP` | 开了 2FA，命令会提示你输一次性验证码 |
| `npm notice Publishing to https://registry.npmmirror.com` | 说明 `publishConfig` 被改掉了，**千万别发到镜像**，改回来 |
| 发布成功但 `npx dou-cl` 找不到 | 镜像同步延迟，见第 3 节 |
| `402 Payment Required` | 想发到别人的 scope 下，或 scope 未授权 |

### 发错了想撤

```bash
npm unpublish dou-cl@1.0.0 --force
```

**限制很严**：只有发布后 **72 小时内**、且没有别的包依赖它、且不是被大量下载过的版本才能撤。
所以发布前务必先用 `--dry-run` 看一眼文件列表。

---

## 6. 发布前检查清单

- [ ] `npm whoami --registry=https://registry.npmjs.org/` 能打印用户名
- [ ] `npm test` 全绿（80 条断言）
- [ ] `npm publish --dry-run` 输出的 `Publishing to` 是 **registry.npmjs.org**
- [ ] `--dry-run` 的文件列表里**没有** `test/`、`预览.html`、`.workbuddy/`、`node_modules/`
      （`package.json` 的 `files` 白名单控制，现在只有 `bin` / `src` / `README.md` / `LICENSE`）
- [ ] 升过版本号了（重复发同一个版本会被拒）
- [ ] `git status` 干净、改动的代码都提交了

---

## 7. 可选：推 tag 自动发布（GitHub Actions）

不想每次手动敲，可以在仓库里建 `.github/workflows/publish.yml`：

```yaml
name: publish
on:
  push:
    tags: ['v*']          # 只有推 v1.2.3 这种 tag 才触发，平时 push 不会跑
jobs:
  npm:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write      # npm 的 provenance 用
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: https://registry.npmjs.org/
      - run: npm ci
      - run: npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

用之前要做两件事：

1. 去 <https://www.npmjs.com/settings/~/tokens> 建一个 **Automation** 类型的 token；
2. 在 GitHub 仓库 `Settings → Secrets and variables → Actions` 里加一个 `NPM_TOKEN`。

之后流程就变成：`npm version patch && git push --follow-tags` —— tag 一推，CI 自动发布。

> 注意：这个文件我**没有**替你先建好。因为没配 `NPM_TOKEN` 的话，
> 一旦有 tag 推上去 CI 就会红。你要用的话自己建，或者让我建。

---

## 8. 附：这个包现在的发布配置

```jsonc
{
  "name": "dou-cl",                    // 发布后的包名 → npx dou-cl
  "version": "1.0.0",
  "bin": {
    "dou-cl": "bin/dou-cl.js",         // npx 找的就是这个
    "doucl":  "bin/dou-cl.js"          // 顺手给的短别名（本地安装可用）
  },
  "files": ["bin", "src", "README.md", "LICENSE"],   // 只发这些
  "engines": { "node": ">=16" },
  "dependencies": { "ws": "^8.18.0" }, // 联网用的，就这一个
  "scripts": { "prepublishOnly": "npm test" },        // 发布前自动跑测试
  "publishConfig": { "registry": "https://registry.npmjs.org/", "access": "public" }
}
```

`ws` 这个依赖已经在 tarball 里装好验证过了：本地 `npm i dou-cl-1.0.0.tgz`
之后 `npx ../dou-cl-1.0.0.tgz` 能正常起菜单、开对局、出牌，所以发出去别人也一样能跑。
