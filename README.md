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

### 4. 多个 Harness 同时连接（可选）

不设置 `DSH_CHROME_USE_PORT` 时，插件自动选择端口：先试上次成功的端口（`~/.dsh/dsh-chrome-use/port.json`），再试 18791、18793..18801，跳过 18792。第一个可用端口生效，端口被占用不会让启动直接失败。设置页会显示实际端口。

设置 `DSH_CHROME_USE_PORT` 时严格使用该端口；端口被占用就报 `BRIDGE_START_FAILED`，不会自动换端口。脚本和测试建议显式设置。

```sh
DSH_CHROME_USE_PORT=18793 DSH_CHROME_USE_NAME=Codex dsh
```

`DSH_CHROME_USE_NAME` 是可选的显示名：设置后扩展弹窗会把该端口显示成「Codex · 18793」，方便区分是哪个 Harness；不设置就只显示端口。名字只用于显示，不参与路由，也不会发给其他 Harness。

桌面版从图形界面启动时，可能读不到 shell 的环境变量。需要按桌面版的方式设置环境变量，或者从终端启动。

配对第二个 Harness 时，把新的 `pairingCode` 粘贴到扩展弹窗即可；它已经包含实际端口。扩展会分别保存每个端口的配对令牌，最多保存 10 个。如果实际端口发生变化，旧令牌会失效，需要用新的配对码重新配对。纯数字旧版兼容码仍只用于 18791。

端口 18792 留给 `scripts/fixture.mjs` 测试页。自动选择会跳过它。

自动模式共用同一个 `port.json`。同时运行多个 Harness 时，建议各自显式设置 `DSH_CHROME_USE_PORT`；否则端口可能随启动顺序变化，导致旧令牌失效、需要重新配对。

多个 Harness 可以同时操作不同的标签页，同一个标签页仍只归一个 Harness。另一个 Harness 抢先占用时返回 `TAB_OWNED_BY_ANOTHER_HARNESS`，不会排队等待。原来的单 Harness 安装不需要改配置。

多个 Harness 之间还可以在后台互相留言：`chrome_send_message` 广播或按端口定向发送，`chrome_messages` 读取，对方会在下一次工具调用的结果里看到未读提示。这是异步留言板，不会打断正在执行的操作，也不会显示在扩展弹窗里。细节和限制见 [Harness 之间的留言板](docs/agent-messaging.md)。

### 5. Codex、OpenCode、Workbody 和其他 Harness

本包是 DSH/Cordis 插件。`package.json` 没有 MCP 入口，也没有命令行入口；把 npm 包装进 Codex 或 OpenCode，不会自动出现 `chrome_*` 工具。

不过扩展本身不挑 Harness：任何能连上 bridge 的客户端，都能操作同一个 Chrome。Codex、OpenCode、Workbody 这类 Harness 用独立 JSON 运行器启动同一个 bridge 即可，配对、端口、标签页租约和留言规则都和 DeepSeek Harness 一样，多个 Harness 还能同时连。具体步骤见 [独立 JSON 运行器](docs/standalone-runner.md)。

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

### 4. Several harnesses at once (optional)

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

Several harnesses can work on different tabs at the same time; a tab still belongs to only one harness. When another harness got there first you get `TAB_OWNED_BY_ANOTHER_HARNESS`, and there is no queueing. Existing single-harness setups need no configuration change.

Harnesses can also leave each other messages in the background: `chrome_send_message` broadcasts or targets a specific port, `chrome_messages` reads them, and the receiver sees an unread hint in the result of its next tool call. This is an asynchronous message board: it does not interrupt a running operation and is not shown in the extension popup. Details and limits: [Messages between harnesses](docs/agent-messaging.md).

### 5. Codex, OpenCode, Workbody and other harnesses

This package is a DSH/Cordis plugin. `package.json` has no MCP entry point and no command-line entry point; dropping the npm package into Codex or OpenCode will not make `chrome_*` tools appear.

The extension itself does not care which harness is on the other end: any client that can reach the bridge can drive the same Chrome. Harnesses such as Codex, OpenCode and Workbody start the same bridge with the standalone JSON runner, and get the same pairing, ports, tab leases and messaging rules as DeepSeek Harness; several harnesses can stay connected at once. See [Standalone JSON runner](docs/standalone-runner.md).
