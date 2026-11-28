# dsh-chrome-use

让 DeepSeek Harness 读取、操作和调试本机 Google Chrome。

同一个扩展和数据通道也能给 Codex、OpenCode、Workbody 等其他 Harness 使用：本包面向 DeepSeek Harness，其他 Harness 通过独立 JSON 运行器接入同一个 bridge，权限、端口和标签页规则完全一样。

## 安装

> **先装 Harness 插件，再装 Chrome 扩展，最后配对。** 插件有三种装法，选一种，命令直接复制。

### 1. 安装 Harness 插件

三种方式任选一种，命令可以直接复制。

**让 Agent 安装（推荐）**：把下面这句话发给你正在用的 Agent：

```text
请安装 DSH 插件 dsh-chrome-use，仓库是 https://github.com/tao1020/dsh-chrome-use
```

**GitHub 仓库（始终最新）**

```sh
dsh plugin --profile desktop add github:tao1020/dsh-chrome-use
```

**npm**

```sh
dsh plugin --profile desktop add dsh-chrome-use
```

> npm 镜像（例如 npmmirror）可能比官方晚同步；如果装完发现不是最新版，用上面的 GitHub 方式。

> 命令里的 `desktop` 是桌面版的默认 profile；如果你用别的 profile，把它换成你的名字（例如 `web`）。桌面版也可以直接在「设置 → 插件」里安装，不用命令行。

### 2. 安装 Chrome 扩展

扩展在 Chrome 应用商店。点下面的链接，再点“添加至 Chrome”：

**https://chromewebstore.google.com/detail/anobmlnjdeahldefeikjdmmnckphpdhc**

### 3. 配对连接

在 Harness 设置 → dsh-chrome-use 点“生成配对码”；在 Chrome 工具栏打开 dsh-chrome-use 扩展，粘贴 8 位配对码（可能含字母，已包含端口，不用手填），点“连接”。也可以在对话里说：“请用 chrome_pair 连接浏览器。”

需要 Google Chrome 120 或更新版本、DeepSeek Harness 0.2.1-rc.2 或更新版本。开发和测试使用 Node.js 22 或 24。

配对成功后，重启 Harness、Chrome 或扩展自动更新都会自动重连。点“断开全部连接”会停止自动重连；下次配对码留空，点“连接”即可。清除配对数据后需要重新配对。

**连接即允许 Harness 操作此 Chrome 中的全部普通网页，包括已登录的网站。** 网页内容、截图和调试信息可能发送给你在 Harness 配置的模型服务。详见 [隐私说明](PRIVACY.md)。

### 4. 在对话里 @ 一个标签页

在输入框里打 `@`，菜单里会多出「Chrome 标签页」一组，列出当前 Chrome 里所有 http/https 页面（标题和网址）。选中一个就插入一个标签页引用；发送后 Harness 拿到的是这一页的 tabId、标题和网址，不用再从几十个标签里猜是哪一页。引用会单独成一行，并用一条 `---` 分隔线和你自己写的话隔开，所以对话记录里只有「[Chrome 标签页 #123] 《标题》 网址」加一条线，不是一大段提示词。

选中的标签页仍然要先 `chrome_claim` 才能操作，因为一个标签页同时只归一个会话。「先 claim、再 snapshot」这些说明写在运行期 skill 和工具描述里，不再塞进你的消息。扩展没连接时这一组只显示一行提示，不影响其他 `@` 候选。

不想打开 `@` 菜单时，也可以直接在标签页上点右键，选「复制 DSH Chrome Use 引用」。扩展会把同一种引用（`[Chrome 标签页 #123] 《标题》 网址` 加一条分隔线）写进系统剪贴板；粘贴到 DSH 输入框里，模型收到的内容和用 `@` 选中这一页相同。复制本身不需要先配对，也不占用标签页；但 Harness 要操作这一页，仍然需要扩展已连接，并先 `chrome_claim`。

### 5. 多个 Harness 同时连接（可选）

不设置 `DSH_CHROME_USE_PORT` 时，插件自动选择端口：先试上次成功的端口（`~/.dsh/dsh-chrome-use/port.json`），再试 18791、18793..18801，跳过 18792。第一个可用端口生效，端口被占用不会让启动直接失败。设置页会显示实际端口。

设置 `DSH_CHROME_USE_PORT` 时严格使用该端口；端口被占用就报 `BRIDGE_START_FAILED`，不会自动换端口。脚本和测试建议显式设置。

```sh
DSH_CHROME_USE_PORT=18793 DSH_CHROME_USE_NAME=Codex dsh
```

`DSH_CHROME_USE_NAME` 是可选的显示名：设置后扩展弹窗会把该端口显示成「Codex · 18793」，方便区分是哪个 Harness；不设置就只显示端口。名字只用于显示，不参与路由，也不会发给其他 Harness。

桌面版从图形界面启动时，可能读不到 shell 的环境变量。需要按桌面版的方式设置环境变量，或者从终端启动。

配对第二个 Harness 时，把新的 `pairingCode` 粘贴到扩展弹窗即可；它已经包含实际端口。扩展会分别保存每个端口的配对令牌，最多保存 10 个。如果实际端口发生变化，旧令牌会失效，需要用新的配对码重新配对。纯数字旧版兼容码仍只用于 18791。

端口 18792 留给 `scripts/fixture.mjs` 测试页。自动选择会跳过它。

需要收窄权限时，用 `DSH_CHROME_USE_ALLOWED_ACTIONS` 限定这个部署能用的工具，逗号分隔短名，例如 `DSH_CHROME_USE_ALLOWED_ACTIONS=snapshot,tabs,click`。设置后没列出的工具会返回 `ACTION_NOT_ALLOWED`（fail-closed，写错名字等于禁用）；`chrome_setup`、`chrome_status`、`chrome_pair`、`chrome_doctor`、`chrome_report` 这几个诊断工具始终可用。不设置则全部可用。`chrome_status` 和 `chrome_doctor` 会显示实际允许的清单。

自动模式共用同一个 `port.json`。同时运行多个 Harness 时，建议各自显式设置 `DSH_CHROME_USE_PORT`；否则端口可能随启动顺序变化，导致旧令牌失效、需要重新配对。

多个 Harness 可以同时操作不同的标签页，同一个标签页仍只归一个 Harness。另一个 Harness 抢先占用时返回 `TAB_OWNED_BY_ANOTHER_HARNESS`，不会排队等待。原来的单 Harness 安装不需要改配置。

多个 Harness 之间还可以在后台互相留言：`chrome_send_message` 广播或按端口定向发送，`chrome_messages` 读取，对方会在下一次工具调用的结果里看到未读提示。这是异步留言板，不会打断正在执行的操作，也不会显示在扩展弹窗里。细节和限制见 [Harness 之间的留言板](docs/agent-messaging.md)。

### 6. Codex、OpenCode、Workbody 和其他 Harness

本包是 DSH/Cordis 插件。`package.json` 没有 MCP 入口，也没有命令行入口；把 npm 包装进 Codex 或 OpenCode，不会自动出现 `chrome_*` 工具。

不过扩展本身不挑 Harness：任何能连上 bridge 的客户端，都能操作同一个 Chrome。Codex、OpenCode、Workbody 这类 Harness 用独立 JSON 运行器启动同一个 bridge 即可，配对、端口、标签页租约和留言规则都和 DeepSeek Harness 一样，多个 Harness 还能同时连。具体步骤见 [独立 JSON 运行器](docs/standalone-runner.md)。

### 7. 跨机器连接（进阶可选项，只允许内网）

默认行为不变：扩展只连本机的 `127.0.0.1`。只有 Chrome 和 Harness 不在同一台机器上时（例如 Chrome 跑在局域网里另一台机器的远程桌面或容器里），才需要这一节。

Harness 侧要同时给端口和绑定地址，因为自动选端口只在 `127.0.0.1` 上探测：

```bash
DSH_CHROME_USE_PORT=18791 DSH_CHROME_USE_BIND_HOST=192.168.1.20 dsh web
```

扩展侧：打开扩展弹窗 → 「进阶：服务器地址」→ 填同一个内网 IP → 重新粘贴配对码连接。地址留空就是默认的 `127.0.0.1`。

限制：

- 只接受环回和内网地址：`127.0.0.0/8`、`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`、`169.254.0.0/16`、`::1`、`fc00::/7`、`fe80::/10`。域名和公网 IP 会被拒绝，因为域名可以解析到任何地方，而这个设置决定页面内容发往哪里。
- 连接是明文 WebSocket：页面正文、截图和调试信息都会发到那台机器。只在信任的内网里用，不要把端口暴露到公网。
- 一个 Chrome 配置同时只填一个服务器地址；要连两台机器，用两个 Chrome 配置，或让其中一台走 SSH 隧道。

公网服务器更安全的做法是用 SSH 隧道，把远端的桥映射到本机回环，扩展地址保持 `127.0.0.1` 不变：

```bash
ssh -L 18791:127.0.0.1:18791 user@server
```

### 8. 维护者：冒烟测试与商店发布

- `npm run smoke`：用无头 Chrome 加载未打包的扩展，确认 service worker 正常注册。CI 的 `Real Chrome smoke` 任务跑同一段脚本。
- `npm run publish:store`：把 `dist/dsh-chrome-use-<version>.zip` 上传到 Chrome Web Store 并提交审核。需要环境变量 `CWS_CLIENT_ID`、`CWS_CLIENT_SECRET`、`CWS_REFRESH_TOKEN`、`CWS_APP_ID`；凭据只从环境读取，不会写进日志。工作流 `.github/workflows/publish-store.yml` 用 `chrome-web-store` 环境保存这些密钥，并要求 tag `release-v<version>` 指向 main 的同一个提交。
- 商店版本和 npm 版本共用 `package.json` 的 `version`；发布前先 `npm run package` 生成 zip，并在 `CHROMEWEBSTORE.md` 的版本表加一行。

---

# dsh-chrome-use

Let DeepSeek Harness read, operate and debug the Google Chrome on your machine.

The same extension and data channel also work for Codex, OpenCode, Workbody and other harnesses: this package targets DeepSeek Harness, and other harnesses attach to the same bridge through the standalone JSON runner, with identical permissions, ports and tab rules.

## Install

> **Install the Harness plugin first, then the Chrome extension, then pair them.** The plugin can be installed in three ways; pick one and copy the command.

### 1. Install the Harness plugin

Pick any of the three ways below; the commands are ready to copy.

**Let your agent do it (recommended)**: send this sentence to the agent you are using:

```text
Please install the DSH plugin dsh-chrome-use from https://github.com/tao1020/dsh-chrome-use
```

**GitHub repository (always the latest)**

```sh
dsh plugin --profile desktop add github:tao1020/dsh-chrome-use
```

**npm**

```sh
dsh plugin --profile desktop add dsh-chrome-use
```

> npm mirrors (npmmirror, for example) may lag behind the official registry; if you end up with an older version, use the GitHub method above.

> `desktop` in the command is the default profile of the desktop app; if you use another profile, replace it with its name (for example `web`). The desktop app can also install plugins from Settings → Plugins, without a command line.

### 2. Install the Chrome extension

The extension lives in the Chrome Web Store. Open the link below and click "Add to Chrome":

**https://chromewebstore.google.com/detail/anobmlnjdeahldefeikjdmmnckphpdhc**

### 3. Pair

In the Harness settings → dsh-chrome-use, click "Generate pairing code"; open the dsh-chrome-use extension from the Chrome toolbar, paste the 8-character code (it may contain letters and already carries the port, so you do not fill the port in), and click "Connect". You can also just say in the chat: "please connect the browser with chrome_pair."

Requires Google Chrome 120 or newer and DeepSeek Harness 0.2.1-rc.2 or newer. Development and tests use Node.js 22 or 24.

After a successful pairing, restarting the Harness, restarting Chrome, or an extension auto-update reconnects automatically. "Disconnect all" stops automatic reconnecting; next time leave the pairing code empty and click "Connect". Clearing the pairing data requires pairing again.

**Connecting lets the Harness operate every normal web page in this Chrome, including sites you are logged in to.** Page content, screenshots and debugging information may be sent to the model service configured in your Harness. See [Privacy](PRIVACY.md).

### 4. @ a tab in the conversation

Type `@` in the composer and a "Chrome 标签页" group lists every http/https page open in Chrome, with its title and URL. Picking one inserts a tab reference, so the message carries that page's tabId, title and URL instead of making the model guess between dozens of tabs. The reference sits on its own line, separated from your own words by a `---` rule, so the transcript stays short: one `[Chrome 标签页 #123] 《title》 url` line and a divider, not a paragraph of instructions.

The picked tab still needs `chrome_claim` before any operation, because a tab belongs to one chat at a time. That rule, and what to do on TAB_NOT_OWNED, lives in the runtime skill and the tool descriptions instead of your message. When the extension is not connected the group shows a single hint row and leaves the other `@` candidates alone.

You can also right-click a tab and choose "复制 DSH Chrome Use 引用" instead of opening the `@` menu. The extension writes the same reference (`[Chrome 标签页 #123] 《title》 url` plus a divider) to the system clipboard; what the model receives after pasting is the same as picking that tab with `@`. Copying does not require pairing and does not claim the tab, but the Harness still needs a connected extension and must `chrome_claim` before operating on the page.

### 5. Several harnesses at once (optional)

When `DSH_CHROME_USE_PORT` is not set, the plugin picks a port automatically: it first tries the last successful port (`~/.dsh/dsh-chrome-use/port.json`), then 18791 and 18793..18801, skipping 18792. The first free port wins, so a busy port no longer makes startup fail. The settings page shows the actual port.

When `DSH_CHROME_USE_PORT` is set, that port is used strictly; if it is busy the plugin reports `BRIDGE_START_FAILED` instead of moving to another port. Scripts and tests should set it explicitly.

```sh
DSH_CHROME_USE_PORT=18793 DSH_CHROME_USE_NAME=Codex dsh
```

`DSH_CHROME_USE_NAME` is an optional display name: the extension popup then shows that port as "Codex · 18793", which makes harnesses easy to tell apart; without it, only the port is shown. The name is display-only, plays no part in routing, and is not shared with other harnesses.

When the desktop app is started from the GUI it may not see shell environment variables. Set them the way the desktop app expects, or start it from a terminal.

To pair a second Harness, paste its new `pairingCode` into the extension popup; the code already carries the actual port. The extension stores a separate token for each port, up to 10 of them. If the actual port changes, the old token stops working and you need to pair again with a new code. The old numeric compatibility code still only works on port 18791.

Port 18792 is reserved for the `scripts/fixture.mjs` test page; automatic selection skips it.

Automatic mode shares one `port.json`. When running several harnesses, set `DSH_CHROME_USE_PORT` explicitly for each; otherwise the port a harness gets can depend on startup order, which invalidates the old token and forces a new pairing.

To narrow the surface, set `DSH_CHROME_USE_ALLOWED_ACTIONS` to a comma-separated list of short tool names, for example `DSH_CHROME_USE_ALLOWED_ACTIONS=snapshot,tabs,click`. Tools outside the list fail with `ACTION_NOT_ALLOWED` (fail-closed: a typo disables the tool); the diagnostics `chrome_setup`, `chrome_status`, `chrome_pair`, `chrome_doctor` and `chrome_report` always stay available. Unset means every tool is available. `chrome_status` and `chrome_doctor` report the effective list.

Several harnesses can work on different tabs at the same time; a tab still belongs to only one harness. When another harness got there first you get `TAB_OWNED_BY_ANOTHER_HARNESS`, and there is no queueing. Existing single-harness setups need no configuration change.

Harnesses can also leave each other messages in the background: `chrome_send_message` broadcasts or targets a specific port, `chrome_messages` reads them, and the receiver sees an unread hint in the result of its next tool call. This is an asynchronous message board: it does not interrupt a running operation and is not shown in the extension popup. Details and limits: [Messages between harnesses](docs/agent-messaging.md).

### 6. Codex, OpenCode, Workbody and other harnesses

This package is a DSH/Cordis plugin. `package.json` has no MCP entry point and no command-line entry point; dropping the npm package into Codex or OpenCode will not make `chrome_*` tools appear.

The extension itself does not care which harness is on the other end: any client that can reach the bridge can drive the same Chrome. Harnesses such as Codex, OpenCode and Workbody start the same bridge with the standalone JSON runner, and get the same pairing, ports, tab leases and messaging rules as DeepSeek Harness; several harnesses can stay connected at once. See [Standalone JSON runner](docs/standalone-runner.md).

### 7. Connecting across machines (optional, private networks only)

The default does not change: the extension dials `127.0.0.1`. This section is only for the case where Chrome and the Harness run on different machines, for example Chrome inside a remote desktop or container on the LAN.

The Harness side needs an explicit port as well as the bind address, because automatic port selection only probes `127.0.0.1`:

```bash
DSH_CHROME_USE_PORT=18791 DSH_CHROME_USE_BIND_HOST=192.168.1.20 dsh web
```

In the extension: open the popup, expand "进阶：服务器地址" (advanced: server address), fill in the same private IP, paste the pairing code again and connect. Leave it empty for the `127.0.0.1` default.

Limits:

- Only loopback and private addresses are accepted: `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1`, `fc00::/7`, `fe80::/10`. Hostnames and public IPs are refused, because a hostname can resolve anywhere and this setting decides where page content travels.
- The connection is plain WebSocket, so page text, screenshots and debug information go to that machine in clear text. Use it only on a network you trust, and never expose the port to the internet.
- One Chrome profile holds one server address. To reach two machines, use two profiles, or keep one of them behind an SSH tunnel.

For a server on the public internet, prefer an SSH tunnel that maps the remote bridge onto your own loopback and leave the extension address at `127.0.0.1`:

```bash
ssh -L 18791:127.0.0.1:18791 user@server
```

### 8. Maintainers: smoke test and store release

- `npm run smoke` loads the unpacked extension in headless Chrome and checks that its service worker registers; the `Real Chrome smoke` CI job runs the same script.
- `npm run publish:store` uploads `dist/dsh-chrome-use-<version>.zip` to the Chrome Web Store and submits it for review. It reads `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN` and `CWS_APP_ID` from the environment only. `.github/workflows/publish-store.yml` keeps those secrets in the `chrome-web-store` environment and requires the `release-v<version>` tag to point at main.
- The store build and the npm package share `package.json`'s `version`; run `npm run package` before publishing and add the matching row to the version table in `CHROMEWEBSTORE.md`.
