# dsh-chrome-use

让 DeepSeek Harness 读取、操作和调试本机 Google Chrome。

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

不设置 `DSH_CHROME_USE_PORT` 时，插件自动选择端口：先试上次成功的端口（`~/.dsh/dsh-chrome-use/port.json`），再试 18791、18793..18799，跳过 18792。第一个可用端口生效，端口被占用不会让启动直接失败。设置页会显示实际端口。

设置 `DSH_CHROME_USE_PORT` 时严格使用该端口；端口被占用就报 `BRIDGE_START_FAILED`，不会自动换端口。脚本和测试建议显式设置。

```sh
DSH_CHROME_USE_PORT=18793 dsh
```

桌面版从图形界面启动时，可能读不到 shell 的环境变量。需要按桌面版的方式设置环境变量，或者从终端启动。

配对第二个 Harness 时，把新的 `pairingCode` 粘贴到扩展弹窗即可；它已经包含实际端口。扩展会分别保存每个端口的配对令牌，最多保存 4 个。如果实际端口发生变化，旧令牌会失效，需要用新的配对码重新配对。纯数字旧版兼容码仍只用于 18791。

端口 18792 留给 `scripts/fixture.mjs` 测试页。自动选择会跳过它。

自动模式共用同一个 `port.json`。同时运行多个 Harness 时，建议各自显式设置 `DSH_CHROME_USE_PORT`；否则端口可能随启动顺序变化，导致旧令牌失效、需要重新配对。

多个 Harness 可以同时操作不同的标签页，同一个标签页仍只归一个 Harness。另一个 Harness 抢先占用时返回 `TAB_OWNED_BY_ANOTHER_HARNESS`，不会排队等待。原来的单 Harness 安装不需要改配置。

### 5. Codex、OpenCode 和其他 Harness

本包是 DSH/Cordis 插件。`package.json` 没有 MCP 入口，也没有命令行入口；把 npm 包装进 Codex 或 OpenCode，不会自动出现 `chrome_*` 工具。

需要手工联调时，可以用独立 JSON 运行器启动同一个 bridge。它不注册 MCP 工具，只按行读取 JSON。具体步骤见 [独立 JSON 运行器](docs/standalone-runner.md)。

## 能做什么

连接后，AI 可以选择所有普通 HTTP(S) 标签页，无需逐页点击授权。支持读取页面结构，或把正文读成纯文本/近似 Markdown；按名称和角色查找元素；点击（含双击和右键）、填写输入框和 contenteditable 区域、按键和组合键、悬停、拖拽、下拉选择、单文件或多文件上传（包括页面动态创建、没挂到 DOM 上的文件输入框）、等待页面状态、网络空闲或自定义条件、页面导出 PDF、处理 alert/confirm/prompt、滚动和滚动到元素、刷新/后退/前进、激活标签页、视口/整页/元素截图（可选把图片直接返回给模型）、导航，查看带游标的控制台日志、JavaScript 错误和网络请求，按需读取某条响应体，以及查看 Chrome 下载记录。

插件安装后会自动注册同名技能 `dsh-chrome-use`。AI 需要操作 Chrome 时会按需加载它，按里面的连接、操作和收尾流程执行；也可以在对话里输入 `/dsh-chrome-use` 主动加载。不需要另外安装 skill 文件，也不需要手动改系统提示词。

扩展使用 Chrome 的 `debugger` 接口。调试时，Chrome 会显示调试提示条；点击时，页面短暂显示蓝色箭头。页面定位使用浏览器的无障碍树和 DOM，点击、输入通过浏览器输入事件执行。扩展弹窗里有一个「前台模式」开关，决定点击、输入时怎么处理窗口：

- **开（默认）**：操作前把浏览器窗口抬到最前面，页面一定能收到输入，但会抢走你当前正在用的应用的焦点。
- **关（后台静默）**：只在 Chrome 自己的窗口里把目标标签页切为当前标签页，不抢焦点，在别的软件里打字不会被打断；代价是窗口被最小化或完全遮挡时操作会返回 `PAGE_HIDDEN`，不会偷偷弹窗。

同一个标签页只能由一个 Harness 会话占用。AI 用 `chrome_claim` 和 `chrome_release` 管理占用，不需要你手动分配。占用申请按先来后到排队，最多等 10 秒；原会话释放后，下一个会话才能接手，不会强行抢占。任务结束后应及时释放。

不同标签页的读取、等待等操作可以并行。点击、输入、拖拽等会切换当前标签页的操作共用一把锁，自动排队，避免两条命令在同一个窗口里互相切页；排队时间计入命令超时。关掉「前台模式」后，这些操作不改变窗口焦点；`chrome_activate` 在任何模式下都会把浏览器窗口抬到最前。同一标签页同时只执行一条命令，重叠调用返回 `TAB_BUSY`。`chrome_close` 真正关闭页面；`chrome_release` 只解除占用，保留页面。

`chrome_open` 必须带一个组名（`group`，1-40 个字符），新建的标签页会立刻放进同名 Chrome 标签页组：同一系列任务的多个标签页复用同一个组名，扩展会在同一窗口里找同名组并加入，找不到就建组；组的颜色由组名稳定生成，所以同一系列总是同色。分组失败（例如固定标签页）不会影响打开动作，结果里会带 `groupError`。

## 页面动态创建的上传框

有些页面不把 `<input type="file">` 放进 DOM，而是临时创建后直接 `click()` 打开系统选择框。这种元素拿不到 ref，用下面两步：

```js
chrome_click({ tabId, ref: "上传按钮的 ref", chooser: true })
chrome_upload({ tabId, chooser: true, paths: ["/Users/tao/Downloads/a.diag"] })
```

第一步会在点击前拦截文件选择框，结果里带 `chooserMode`；第二步把文件注入被拦截的选择框，页面照常收到 `change` 事件。两步要在 30 秒内完成，没人消费会自动取消；只想关掉选择框用 `cancel: true`。页面自己的 `change` 处理报错时，用 `chrome_logs` 看 JavaScript 异常。

## 更新

Chrome 扩展由 Chrome 应用商店自动更新，也可以在 `chrome://extensions` 点击扩展卡片的“更新”手动检查。Harness 插件在插件管理里更新。每个版本的改动见 [更新日志](CHANGELOG.md)。

两边分别更新，版本不必完全一致；设置页的“检查更新”只查询 GitHub 最新正式版本，不会自动下载。已连接的扩展版本显示在设置页的“连接状态”。

## 反馈问题

工具意外失败时，AI 会先说明失败原因，再问你要不要给插件提一个 issue。你同意后，它用 `chrome_report` 生成一个预填的 GitHub issue 链接：

- 只包含工具名、错误信息和版本（插件、扩展、系统），不包含页面内容、截图、Cookie 或登录信息。
- 链接里的网址会去掉查询参数，提交前你还能再检查一遍。
- 提交动作由你在 GitHub 页面上完成，插件不会自动提交。

## 测试与开发

```sh
npm ci --ignore-scripts
npm run check
npm test
node scripts/fixture.mjs
```

最后一个命令启动专用测试页：`http://127.0.0.1:18792/`。保持服务运行，把 [验收提示词](docs/harness-test-prompt.md) 交给 Harness。使用 `dsh --profile headless --json` 可记录工具调用和最终结论。模型、API Key 和插件必须配置在测试使用的 profile 中。

无需模型时，可以运行 `npm run dev`，按行输入 JSON，例如 `{"action":"status"}`。首次连接用 `{"action":"pair"}` 生成配对码。未设置 `DSH_CHROME_USE_PORT` 时它和插件一样自动选择端口；设置时严格使用该端口。配对信息按实际端口保存在 `~/.dsh/dsh-chrome-use/` 或 `~/.dsh/dsh-chrome-use/port-<端口>/`。调试服务和 Harness 不要同时占用同一个端口。

开发扩展时不用装商店版：在 `chrome://extensions` 开启“开发者模式”，点击“加载已解压的扩展程序”，选择本仓库的 `extension/` 目录；改完代码在该页点击刷新。

本仓库的自动化测试覆盖配对、会话占用、超时、取消、断线、页面限制、过期元素引用和输入行为。真实 Chrome 验收需要单独运行，单元测试通过不代表浏览器验收通过。

## 排查连接问题

- `BRIDGE_START_FAILED`：显式指定的端口被占用，或自动选择的候选端口全部被占用。先停止重复服务，或用 `DSH_CHROME_USE_PORT` 指定一个空闲端口。
- `AUTH_FAILED`：在 Harness 设置页的 dsh-chrome-use 里点“生成配对码”（或让 AI 调用 `chrome_pair`），再到扩展弹窗连接。实际端口变化后旧令牌会失效，需要用新的 `pairingCode` 重新配对。
- `TAB_IN_USE`：等待 10 秒后，其他 Harness 会话仍占用该页。让原会话释放，或新建自己的标签页。
- `TAB_BUSY`：这个标签页还有一条命令在运行。等它结束再操作同一页，或改用其他标签页；不同标签页可以直接并行。
- `TAB_OWNED_BY_ANOTHER_HARNESS`：另一个 Harness 已占用这个标签页。让它在自己的会话里调用 `chrome_release`，或者换一个标签页。这个错误不会跨 Harness 排队。
- `TAB_NOT_OWNED`：这个标签页不在当前 Harness 的占用表里——从没 `chrome_claim`，或者已经 `chrome_release`。先 claim 再操作。消息可能带诊断后缀 `(Chrome detached this tab <n>s ago: <reason>)`，说明 Chrome 之前主动解除了调试，例如 `target_closed`、`replaced_with_devtools`。
- `TAB_NOT_LEASED`：Harness 以为还占着这个标签页，但扩展侧的租约已经丢失（常见于重载扩展后旧连接残留）。先用 `chrome_tabs` 确认页面还在，再重新 `chrome_claim`。它和 `TAB_NOT_OWNED` 都表示“还没有占用、需要先 claim”，只是检查层级不同。
- `TAB_LEASE_QUARANTINED`：Chrome 没能完成上一次调试清理。重载扩展后再试；在重载前不要继续操作这个标签页。
- `TAB_LEASE_CLOSING`：这个标签页正在被另一个 Harness 断开或清理。等清理完成后再试；不要循环重试。
- Chrome 调试器冲突：关闭该页的 DevTools 或释放其他浏览器工具的会话，再检查连接。不要同时用 Codex 和 Harness 操作同一页。
- 操作超时或取消：请求停止这一条命令，等扩展确认清理完成后才释放操作锁，不会自动重放。其他标签页通常不受影响；若清理超过 8 秒仍未确认，会断开连接，避免旧操作影响新会话。取消打开页面时若收到迟到的成功结果，也会断开，以清理无人占用的调试连接；新页面可能保留。旧版扩展无法单独取消命令，也会断开。重新占用并读取页面，确认之前的点击或输入是否已经发生。

## 当前限制

- **PAGE_HIDDEN**：Chrome 只把合成的输入交给“可见窗口里的当前标签页”。关掉「前台模式」后，窗口最小化或被系统判定完全遮挡时标签页处于 hidden，操作会返回 `PAGE_HIDDEN`，插件不会偷偷把窗口弹到前面；需要先调用 `chrome_activate` 把页面调出来再重试。开着「前台模式」时窗口会被抬到最前，不会报这个错。个别依赖 `document.hasFocus()` 的网页可能也需要页面先获得焦点。
- **同窗口切换标签页**：如果自动化的标签页和 Harness 网页界面在同一个 Chrome 窗口里，切换当前标签页仍会暂时改变这个窗口显示的内容，但不会抢走窗口焦点，也不会影响你正在用的其他软件。把两者放在不同窗口就可以完全不影响你。
- **仅支持 HTTP(S)**：仅支持普通 HTTP(S) 网页，不支持 Chrome 内部页面、本地文件或扩展页面。
- **其他页面调试**：Chrome 还可能限制其他页面的调试。
- **并发锁需要同步更新**：并发和前台操作锁需要新版 Harness 插件与 Chrome 扩展一起更新。旧扩展仍一次只执行一条命令。
- **多 Harness 同时连接**：需要新版扩展；旧扩展只有一个连接，只支持 18791，不会跟随自动选择的端口。不同 Harness 之间标签页占用由扩展统一管理；同一 Harness 内部的排队规则不变。
- **锁只协调本插件操作**：锁只协调本插件发出的操作，不能阻止你手动切页、其他扩展或网页脚本改变焦点。
- **会话占用不会自动到期**：会话遗留的占用不会自动到期，以免打断仍在工作的会话。应让原会话释放。
- **顶层页面元素**：点击、输入和拖拽目前仅支持顶层页面元素，不支持跨域 iframe。
- **文件上传**：文件上传只接受 home 或临时目录下、由用户明确指定的普通文件。HTML5 拖拽是页面内合成事件，个别站点可能不认，拖完要确认结果。
- **HTML5 拖拽源**：拖拽源不一定是按钮；有些 `div[draggable]` 在 `snapshot` 里显示为 `role=group`、名称为空，但仍有可用的 `ref`。从快照上下文（周围文字、位置）确认哪一块是拖拽源，把它的 `ref` 传给 `chrome_drag` 的 `fromRef`。不要按名称 `find`，也不要把任意 `group` 当成拖拽源。
- **snapshot 正文提取**：`snapshot` 的 `text`/`markdown` 模式是正文提取的近似结果。Markdown 不保证还原表格、嵌套列表和复杂布局，也不做正文区域识别或去广告。
- **find 结果过多**：`find` 不加 500 条上限，但结果太多时应缩小名称或角色。
- **网络请求记录**：网络请求只保留最近 200 条元数据，响应体需要按 `requestId` 单独读取，Chrome 可能已将其释放。
- **响应可能含敏感信息**：读取到的内容可能包含令牌或个人信息。
- **downloads 权限**：下载列表需要扩展的 `downloads` 权限，从 0.5.0 起随扩展更新申请。旧版本升级后 Chrome 可能要求你重新确认权限。
- **chrome_evaluate**：`chrome_evaluate` 可为调试执行 JavaScript，可能修改页面。
- **不可信页面内容**：页面内容是不可信数据，不能把网页中的指令当作用户授权。
- **截图**：截图保存到本机，模型能否理解截图取决于模型能力。

## 打包

```sh
npm run package
npm pack --pack-destination dist
```

`dist/` 包含 Chrome 扩展 ZIP、校验值和 Harness 插件包。GitHub Actions 会在 Node.js 22、24 和三个操作系统上运行检查，并生成测试构建。这不会发布到扩展商店，也不会自动发布 npm 包。
