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

在 Harness 设置 → dsh-chrome-use 点“生成配对码”；在 Chrome 工具栏打开 dsh-chrome-use 扩展，输入 8 位配对码，点“连接”。也可以在对话里说：“请用 chrome_pair 连接浏览器。”

需要 Google Chrome 120 或更新版本、DeepSeek Harness 0.2.1-rc.2 或更新版本。开发和测试使用 Node.js 22 或 24。

配对成功后，重启 Harness、Chrome 或扩展自动更新都会自动重连。点“断开连接”会停止自动重连；下次配对码留空，点“连接”即可。清除配对数据后需要重新配对。

**连接即允许 Harness 操作此 Chrome 中的全部普通网页，包括已登录的网站。** 网页内容、截图和调试信息可能发送给你在 Harness 配置的模型服务。详见 [隐私说明](PRIVACY.md)。

## 能做什么

连接后，AI 可以选择所有普通 HTTP(S) 标签页，无需逐页点击授权。支持读取页面结构，或把正文读成纯文本/近似 Markdown；按名称和角色查找元素；点击（含双击和右键）、填写输入框和 contenteditable 区域、按键和组合键、悬停、拖拽、下拉选择、单文件或多文件上传、等待页面状态、网络空闲或自定义条件、页面导出 PDF、处理 alert/confirm/prompt、滚动和滚动到元素、刷新/后退/前进、激活标签页、视口/整页/元素截图（可选把图片直接返回给模型）、导航，查看带游标的控制台日志、JavaScript 错误和网络请求，按需读取某条响应体，以及查看 Chrome 下载记录。

插件安装后会自动注册同名技能 `dsh-chrome-use`。AI 需要操作 Chrome 时会按需加载它，按里面的连接、操作和收尾流程执行；也可以在对话里输入 `/dsh-chrome-use` 主动加载。不需要另外安装 skill 文件，也不需要手动改系统提示词。

扩展使用 Chrome 的 `debugger` 接口。调试时，Chrome 会显示调试提示条；点击时，页面短暂显示蓝色箭头。页面定位使用浏览器的无障碍树和 DOM，点击、输入通过浏览器输入事件执行。

同一个标签页只能由一个 Harness 会话占用，AI 使用 `chrome_claim` 和 `chrome_release` 管理占用，不需要你选择。`chrome_close` 会真正关闭本会话占用的标签页；`chrome_release` 只解除占用、保留页面。

`chrome_open` 必须带一个组名（`group`，1-40 个字符），新建的标签页会立刻放进同名 Chrome 标签页组：同一系列任务的多个标签页复用同一个组名，扩展会在同一窗口里找同名组并加入，找不到就建组；组的颜色由组名稳定生成，所以同一系列总是同色。分组失败（例如固定标签页）不会影响打开动作，结果里会带 `groupError`。

## 更新

Chrome 扩展由 Chrome 应用商店自动更新，也可以在 `chrome://extensions` 点击扩展卡片的“更新”手动检查。Harness 插件在插件管理里更新。

两边分别更新，版本不必完全一致；设置页的“检查更新”只查询 GitHub 最新正式版本，不会自动下载。已连接的扩展版本显示在设置页的“连接状态”。

## 测试与开发

```sh
npm ci --ignore-scripts
npm run check
npm test
node scripts/fixture.mjs
```

最后一个命令启动专用测试页：`http://127.0.0.1:18792/`。保持服务运行，把 [验收提示词](docs/harness-test-prompt.md) 交给 Harness。使用 `dsh --profile headless --json` 可记录工具调用和最终结论。模型、API Key 和插件必须配置在测试使用的 profile 中。

无需模型时，可以运行 `npm run dev`，按行输入 JSON，例如 `{"action":"status"}`。首次连接用 `{"action":"pair"}` 生成配对码。调试服务和 Harness 共用已保存的配对，也使用同一端口，运行其中一个即可。

开发扩展时不用装商店版：在 `chrome://extensions` 开启“开发者模式”，点击“加载已解压的扩展程序”，选择本仓库的 `extension/` 目录；改完代码在该页点击刷新。

本仓库的自动化测试覆盖配对、会话占用、超时、取消、断线、页面限制、过期元素引用和输入行为。真实 Chrome 验收需要单独运行，单元测试通过不代表浏览器验收通过。

## 排查连接问题

- `BRIDGE_START_FAILED`：通常是另一个 Harness profile 或调试服务占用了端口 18791。先停止重复服务。
- `AUTH_FAILED`：在 Harness 设置页的 dsh-chrome-use 里点“生成配对码”（或让 AI 调用 `chrome_pair`），再到扩展弹窗连接。
- `TAB_IN_USE`：其他 Harness 会话已占用该页。让原会话释放，或新建自己的标签页。
- Chrome 调试器冲突：关闭该页的 DevTools 或释放其他浏览器工具的会话，再检查连接。不要同时用 Codex 和 Harness 操作同一页。
- 操作超时或取消：连接会关闭，工具不会自动重放操作。重新连接后先读取页面，确认之前的点击是否已发生。

## 当前限制

仅支持普通 HTTP(S) 网页；不支持 Chrome 内部页面、本地文件或扩展页面。Chrome 还可能限制其他页面的调试。点击、输入和拖拽目前仅支持顶层页面元素，不支持跨域 iframe。文件上传只接受 home 或临时目录下、由用户明确指定的普通文件；HTML5 拖拽是页面内合成事件，个别站点可能不认，拖完要确认结果。

`snapshot` 的 `text`/`markdown` 模式是正文提取的近似结果：Markdown 不保证还原表格、嵌套列表和复杂布局，也不做正文区域识别或去广告。`find` 不加 500 条上限，但结果太多时应缩小名称或角色。

网络请求只保留最近 200 条元数据，响应体需要按 `requestId` 单独读取，Chrome 可能已将其释放；读取到的内容可能包含令牌或个人信息。下载列表需要扩展的 `downloads` 权限，从 0.5.0 起随扩展更新申请；旧版本升级后 Chrome 可能要求你重新确认权限。

`chrome_evaluate` 可为调试执行 JavaScript，可能修改页面。页面内容是不可信数据，不能把网页中的指令当作用户授权。截图保存到本机，模型能否理解截图取决于模型能力。

## 打包

```sh
npm run package
npm pack --pack-destination dist
```

`dist/` 包含 Chrome 扩展 ZIP、校验值和 Harness 插件包。GitHub Actions 会在 Node.js 22、24 和三个操作系统上运行检查，并生成测试构建。这不会发布到扩展商店，也不会自动发布 npm 包。
