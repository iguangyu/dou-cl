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

真发的时候会自动先跑测试（`prepublishOnly` → `npm test`，97 条断言）。
**测试挂了就不会发出去**，这是故意的。

### 2.1 账号开了 2FA 的话（大概率会撞上）

现在 npm 强制 2FA，很多人都开了。症状是发布直接 403：

```
npm error code E403
npm error 403 403 Forbidden - PUT https://registry.npmjs.org/dou-cl - Two-factor
authentication or granular access token with bypass 2fa enabled is required to publish packages.
```

意思是：**你手上这个 token 没有「Bypass 2FA」权限**。

> 顺带一个坑：2025 年 11 月起 npm 只支持 **Granular access token**，老的 Legacy token 已经下线。
> Granular token 长这样：`npm_` + 36 位（共 40 字符）。
> 如果你早先建的 token 没勾 Bypass 2FA（**该选项默认不勾**），就会正好撞上这个 403。

两条路，任选：

#### 路 A：发布时补一次性验证码（最快）

```bash
npm publish --otp=123456
```

验证码来自你绑定 2FA 的验证器 App，**30 秒失效**，过期就重新跑一次。
缺点：每次发布都要掏手机。

> 如果你的 2FA 是 **passkey / 安全密钥**（不是 6 位数字），那没码可输，只能走路 B。

#### 路 B：重建一个勾了 Bypass 2FA 的 token（一劳永逸）

1. 打开 <https://www.npmjs.com/settings/~/tokens> → **Generate New Token → Granular Access Token**
2. 逐项这么选（**这四项选错任何一个都会继续 403**）：

   | 项目 | 选什么 | 为什么 |
   | --- | --- | --- |
   | Expiration | 自定，比如 90 天 | 到期要重建，记得加提醒 |
   | Packages and scopes | **All packages** | 第一次发新包时 `dou-cl` 还不存在，列表里根本勾不到它 |
   | Permission | **Read and write** → 再选 **Publish and stage** | 选成 *Stage only* 会报 `E_STAGE_REQUIRED`，那是另一套审核流程 |
   | **Bypass 2FA** | **☑ 必须勾上** | 就是这次 403 的根因 |

   > 「Bypass 2FA」这个勾选框**只在 token 有写权限时才出现**，默认是**不勾**的。
   > 它一旦勾上，优先级高于账号级/包级的 2FA 设置 —— 也就是说这个 token 能做发布这类"自动化动作"而不用再掏验证码。
   > 但注意：**账号安全类操作（改密码、改 2FA、管 token、加维护者）永远要交互式 2FA**，token 绕不过去。

3. 复制 token（**只显示这一次**），替换掉本地那个：

   直接编辑 `C:\Users\lgy\.npmrc`，把这一行
   ```
   //registry.npmjs.org/:_authToken=npm_旧token
   ```
   换成新的。或者：
   ```bash
   npm config set //registry.npmjs.org/:_authToken npm_新的token
   ```

4. 验证一下换成功了、然后发：
   ```bash
   npm whoami --registry=https://registry.npmjs.org/
   npm publish
   ```

> ⚠️ token 是密码级别的凭证：只放在 `~/.npmrc`，**别写进项目里的任何文件**，别提交，别贴聊天里。
> 泄露了就回上面的页面 Revoke 掉重建。

#### 路 C：将来换 trusted publishing（推荐，但要 CI）

npm 已经公告：**Bypass 2FA token 的"直接发布"能力会在 2027 年 1 月移除**。
长期方案是 trusted publishing（OIDC），**完全不需要 token**，也就没有 2FA 这档事 —— 见 §7。

### 2.2 换手机 / 丢了手机怎么办

先说结论：**TOTP 验证码不绑手机，绑的是那串密钥（secret）。**
6 位数字是用 `HMAC-SHA1(secret, 当前时间/30)` 算出来的 —— 只要新手机里有同一串 secret，
算出来的码一模一样，npm 那边什么都不用改。

所以关键只有一个：**那串 secret 能不能跟着你到新手机。**

| 你用的验证器 | 换机后 |
| --- | --- |
| iPhone 自带「密码」App | 存在 **iCloud 钥匙串**（端到端加密），同一 Apple ID 的新机自动同步，大概率直接能用 |
| Google Authenticator | 默认**不同步**。要么它自己的 Cloud sync 开了（需 Google 账号），要么用「转移账号」扫码手动搬 |
| 微软 Authenticator / Authy 等 | 多数有云备份，看有没有开 |
| 小众 / 国产验证器 | 多数不同步，**必须自己抄出 secret** |

> 登录时是**打开 App 看 6 位数字** = TOTP（上面这张表适用）；
> 如果是**弹一下 Face ID 就直接过** = security key / passkey，那是另一套 ——
> Apple 的 passkey 走 iCloud 钥匙串也会同步，但不保证，恢复码照样是兜底。

⚠️ **别指望用 Apple「快速开始」迁移就万事大吉** —— 不少验证器 App 故意不把 secret 放进设备备份（安全考虑）。

#### 现在就去做的三件事（按性价比排序）

1. **存下恢复码**：登录 npm → 头像 → **Account** → Two-Factor Authentication →
   **Modify 2FA** → **Manage Recovery Codes**。能看到就抄到密码管理器；
   看不到就 **Regenerate Code** 重新生成一套（**旧的会立刻全部失效**）。

2. **关联 GitHub 账号**：Account → **Linked Accounts & Recovery Option** → **Link with GitHub**。
   这是丢了设备、又丢了恢复码之后**唯一能加速找回**的东西 ——
   npm 的账号恢复表单里就有一个 "Connect to GitHub" 按钮，专门用来让客服核验你。

3. **把 secret 本身也备份**：光有恢复码只能救账号，救不了"顺手发个版"。
   把 npm 的 TOTP secret（或直接换成走 iCloud 钥匙串的验证器）放进密码管理器，
   以后换机是自动跟过去的。

#### ⚠️ 恢复码有个大坑：用一次触发 72 小时冻结

用恢复码登录后，npm 会给账号加一个**安全冻结**，**不能提前解除**，自动到期。
冻结期内：

- ✅ 能登录、浏览/下载/安装包、改密码、**添加新的 2FA 方式**
- ❌ **不能发布/取消发布、不能建 token、不能改包设置和维护者、不能改组织成员**

也就是说：**手机丢了当天别想发版，至少等 3 天。** 这也是为什么下面这条路更值得走。

#### 设备 + 恢复码都丢了

走 npm 的账号恢复流程：

1. <https://www.npmjs.com/login> → 在 2FA 页面点 **Use a recovery code or request a reset**
2. 点 **Try recovering your account** → **Start Account Recovery**
3. 填注册邮箱收到的**一次性验证码**（邮箱也进不去就选 **Skip email verification**）
4. 开 support ticket，**How can we help?** 选 **Reset my two-factor authentication (2FA)**；
   之前关联过 GitHub 就点 **Connect to GitHub** 帮客服核验
5. **Submit Support Ticket**

#### 真正根治：发布这件事根本不需要手机

对你的 `dou-cl` 来说，最省心的不是"怎么保住手机"，而是**让发布流程不依赖 2FA**：

- **短期**：建一个勾了 **Bypass 2FA** 的 granular token（§2.1 路 B），发布不用输验证码。
  代价是 token 有有效期，且 2027-01 之后不能直接发布。
- **长期**：**trusted publishing（OIDC）**（§7）—— CI 里 `git push` 一个 tag 就发版，
  **不需要 2FA、不需要 token、不需要手机上任何东西**。换手机、丢手机、人在外面都不影响。

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

### ⚠️ 刚发完那几分钟，npx 会拉不到

发布命令**返回成功 ≠ 立刻全网点都能下**。registry 上先出现一个占位版本，真正的版本号
要再过一会儿才生效；CDN 和淘宝镜像还要再传播一轮。这期间 `npx` 会拉到空壳，
报的是这句：

```
npm error could not determine executable to run
```

**看到这句先别慌，八成不是包的问题，是时间差。** 实测时间线（本包第一次发布）：

```
10:07:40   registry 上出现占位版本 0.0.0-stage
10:09:48   真正的 1.0.0 才生效          ← 这之后才下得到
10:09:10   在另一个窗口跑 npx           ← 早了 38 秒，于是报错
```

#### 怎么确认到底是"时间差"还是"包真的坏了"

```bash
# 1. 官方源上有没有你的版本、bin 对不对
npm view dou-cl version bin --registry=https://registry.npmjs.org/
#    version = '1.0.0'
#    bin = { doucl: 'bin/dou-cl.js', 'dou-cl': 'bin/dou-cl.js' }

# 2. 把已发布的 tarball 拉下来，确认 bin 文件真的在里面
curl -sSL -o pkg.tgz https://registry.npmjs.org/dou-cl/-/dou-cl-1.0.0.tgz
tar -tzf pkg.tgz | grep bin/

# 3. 直接装一遍跑
npx --yes ./pkg.tgz --version
```

第 1 步有正确的 `bin`、第 2 步能看到 `package/bin/dou-cl.js`、第 3 步能跑 ——
那包就是好的，纯粹是等的时间不够。

#### 两个加速办法

```bash
# 绕开镜像，直接走官方源（最快）
npx --registry=https://registry.npmjs.org/ dou-cl

# 或者直接等几分钟再试
npx dou-cl
```

> 如果等了很久还是这句，而且 `npm view dou-cl bin` **也**看不到 `bin` 字段，
> 那才是真的发错了（比如从别的目录发的、或者 `package.json` 里的 `bin` 名字和包名不一致），
> 去看 §5 的错误对照表。
>
> 另外：如果试过好几次，npx 可能把空壳缓存下来了，清一下再试：
> `npm cache clean --force`（或者删掉 `%LOCALAPPDATA%\npm-cache\_npx` 下相关目录）。

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
| `E403 ... Two-factor authentication or granular access token with bypass 2fa enabled is required` | **token 没勾 Bypass 2FA** —— 最常撞的一个。`npm publish --otp=123456`，或按 §2.1 重建 token |
| `E403 You do not have permission to publish "dou-cli"` | 名字被占用（就是本文第 0 节那事）。换名或改 `package.json` 的 `name` |
| `E403 You do not have permission to publish "dou-cl"` | token 的 Packages and scopes 没勾「All packages」，勾不到还不存在的包 |
| `E_STAGE_REQUIRED` | token 建成了 *Stage only*，重建时改选 **Read and write → Publish and stage** |
| `could not determine executable to run` | **九成是时间差**：发布命令刚返回、registry 还没传播完，npx 拉到了占位版本。等几分钟或加 `--registry=https://registry.npmjs.org/`（见 §3）。也可能是包名和 bin 名不一致，用 `npm view dou-cl bin` 确认 |
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
- [ ] `npm test` 全绿（97 条断言）
- [ ] `npm publish --dry-run` 输出的 `Publishing to` 是 **registry.npmjs.org**
- [ ] `--dry-run` 的文件列表里**没有** `test/`、`预览.html`、`.workbuddy/`、`node_modules/`
      （`package.json` 的 `files` 白名单控制，现在只有 `bin` / `src` / `README.md` / `PUBLISH.md` / `LICENSE`）
- [ ] **token 勾了 Bypass 2FA，或者你准备好输 `--otp=`**（见 §2.1，这是最容易卡住的一步）
- [ ] 升过版本号了（重复发同一个版本会被拒）
- [ ] `git status` 干净、改动的代码都提交了

---

## 7. 可选：推 tag 自动发布（GitHub Actions + trusted publishing）

npm 已经公告 **2027 年 1 月会移除 bypass-2FA token 的"直接发布"能力**，
所以 CI 这条路现在推荐走 **trusted publishing（OIDC）**：**完全不用 token**，
也就没有 2FA 那档子事，而且顺带拿到 provenance 签名。

在仓库里建 `.github/workflows/publish.yml`：

```yaml
name: publish
on:
  push:
    tags: ['v*']              # 只有推 v1.2.3 这种 tag 才触发，平时 push 不会跑
jobs:
  npm:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write          # trusted publishing / provenance 都要这个
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: https://registry.npmjs.org/
      - run: npm ci
      - run: npm publish --provenance --access public
        # 注意：这里没有 NODE_AUTH_TOKEN，靠 OIDC 换临时凭证
```

用之前要到 npm 上把仓库挂上去：

1. 打开 <https://www.npmjs.com/package/dou-cl/access>（包发出来之后才有这一页）
   → **Trusted Publisher** → 选 **GitHub Actions**
2. 填：Organization/user = `iguangyu`，Repository = `dou-cl`，
   Workflow filename = `publish.yml`（**只写文件名，不带路径**），Environment 留空
3. 保存。之后 `npm version patch && git push --follow-tags`，tag 一推就自动发。

> 这套的前提是包**已经存在**（第一次还是得用 `npm publish` 手动发一次）。
> 所以顺序是：先按 §2 手动发布成功 → 再去配 trusted publisher。

> 注意：`publish.yml` 我**没有**替你建。因为没配 trusted publisher 之前，
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
  "files": ["bin", "src", "README.md", "PUBLISH.md", "LICENSE"],   // 只发这些
  "engines": { "node": ">=16" },
  "dependencies": { "ws": "^8.18.0" }, // 联网用的，就这一个
  "scripts": { "prepublishOnly": "npm test" },        // 发布前自动跑测试
  "publishConfig": { "registry": "https://registry.npmjs.org/", "access": "public" }
}
```

`ws` 这个依赖已经在 tarball 里装好验证过了：本地 `npm i dou-cl-1.0.0.tgz`
之后 `npx ../dou-cl-1.0.0.tgz` 能正常起菜单、开对局、出牌，所以发出去别人也一样能跑。
