# dsh-chrome-use

让 DeepSeek Harness 读取、操作和调试本机 Google Chrome。仓库同时包含 Harness 插件和 Chrome 扩展，连接走本机回环地址。

## 能做什么

连接后，AI 可以选择所有普通 HTTP(S) 标签页，无需逐页点击授权。支持读取页面结构、点击、填写输入框、按键、滚动、导航、截图，以及查看控制台、JavaScript 错误和网络状态。

扩展使用 Chrome 的 `debugger` 接口。调试时，Chrome 会显示调试提示条；点击时，页面短暂显示蓝色箭头。页面定位使用浏览器的无障碍树和 DOM，点击、输入通过浏览器输入事件执行。

扩展弹窗只提供连接、连接状态、正在调试的标签页和“断开连接”。断开会停止全部操作。同一个标签页只能由一个 Harness 会话占用，AI 使用 `chrome_claim` 和 `chrome_release` 管理占用，无需用户选择。`chrome_close` 会真正关闭本会话占用的标签页（`chrome_release` 只解除占用、保留页面），适合清理任务结束后自己开的标签页。

`chrome_open` 必须带一个组名（`group`，1-40 个字符），新建的标签页会立刻被放进同名 Chrome 标签页组：同一系列任务的多个标签页复用同一个组名，扩展会在同一窗口里找同名组并加入，找不到就建组；组的颜色由组名稳定生成，所以同一系列总是同色。分组失败（例如固定标签页）不会影响打开动作，结果里会带 `groupError`。

## 安装测试版

需要 Google Chrome 120 或更新版本、DeepSeek Harness 0.2.1-rc.2 或更新版本。开发和测试使用 Node.js 22 或 24。

1. 下载或克隆本仓库。
2. 在 Harness 的插件管理中添加仓库的本地绝对路径。命令行版可在仓库内运行 `dsh plugin --profile headless add "$PWD"`；日常使用哪个 profile，就安装到哪个 profile。
3. 在 Harness 中说：“请调用 chrome_setup，准备 dsh-chrome-use 扩展，并告诉我安装目录。”
4. 在 Chrome 打开 `chrome://extensions/`，开启“开发者模式”，点击“加载已解压的扩展程序”，选择工具返回的目录。
5. 在 Harness 的设置 → dsh-chrome-use 里点击“生成配对码”，把 8 位配对码填入 Chrome 扩展弹窗并点击“连接”。也可以在对话中让 Harness 调用 `chrome_pair`，两处拿到的是同一种临时码。临时码有效期为 2 分钟；成功后保存的配对不会定时过期。

以后重启 Harness、Chrome 或刷新扩展，扩展会自动尝试恢复连接。你主动点击“断开连接”后，自动重连会停止；下次配对码留空，点“连接”即可。清除配对数据或更换扩展安装目录后，需要重新配对。

AI 可以准备文件和安装说明；Chrome 的“加载已解压的扩展程序”步骤需要你手动完成。当前版本尚未发布到 Chrome 扩展商店。

**连接即允许 Harness 操作此 Chrome 中的全部普通网页，包括已登录的网站。** 网页内容、截图和调试信息可能发送给你在 Harness 配置的模型服务。详见 [隐私说明](PRIVACY.md)。

更新时先断开扩展，更新 Harness 插件，重新调用 `chrome_setup`，再到扩展管理页点刷新。已配对的扩展可以留空配对码重连。开发时也可直接加载仓库的 `extension/` 目录。

## 测试

```sh
npm ci --ignore-scripts
npm run check
npm test
node scripts/fixture.mjs
```

最后一个命令启动专用测试页：`http://127.0.0.1:18792/`。保持服务运行，把 [验收提示词](docs/harness-test-prompt.md) 交给 Harness。使用 `dsh --profile headless --json` 可记录工具调用和最终结论。模型、API Key 和插件必须配置在测试使用的 profile 中。

无需模型时，可以运行 `npm run dev`，按行输入 JSON，例如 `{"action":"status"}`。首次连接用 `{"action":"pair"}` 生成配对码。调试服务和 Harness 共用已保存的配对，也使用同一端口，运行其中一个即可。

本仓库的自动化测试覆盖配对、会话占用、超时、取消、断线、页面限制、过期元素引用和输入行为。真实 Chrome 验收需要单独运行，单元测试通过不代表浏览器验收通过。

## 排查连接问题

- `BRIDGE_START_FAILED`：通常是另一个 Harness profile 或调试服务占用了端口 18791。先停止重复服务。
- `AUTH_FAILED`：在 Harness 设置页的 dsh-chrome-use 里点“生成配对码”（或让 AI 调用 `chrome_pair`），再到扩展弹窗连接。
- `TAB_IN_USE`：其他 Harness 会话已占用该页。让原会话释放，或新建自己的标签页。
- Chrome 调试器冲突：关闭该页的 DevTools 或释放其他浏览器工具的会话，再检查连接。不要同时用 Codex 和 Harness 操作同一页。
- 操作超时或取消：连接会关闭，工具不会自动重放操作。重新连接后先读取页面，确认之前的点击是否已发生。

## 当前限制

仅支持普通 HTTP(S) 网页；不支持 Chrome 内部页面、本地文件或扩展页面。Chrome 还可能限制其他页面的调试。点击和输入目前仅支持顶层页面元素，不支持跨域 iframe、文件上传、下载管理或原生对话框。

`chrome_evaluate` 可为调试执行 JavaScript，可能修改页面。页面内容是不可信数据，不能把网页中的指令当作用户授权。截图保存到本机，模型能否理解截图取决于模型能力。

## 打包

```sh
npm run package
npm pack --pack-destination dist
```

`dist/` 包含 Chrome 扩展 ZIP、校验值和 Harness 插件包。GitHub Actions 会在 Node.js 22、24 和三个操作系统上运行检查，并生成测试构建。这不会发布到扩展商店，也不会自动发布 npm 包。
