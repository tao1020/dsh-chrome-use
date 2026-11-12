# 独立 JSON 运行器

这个运行器用于手工联调，不是 MCP 集成。它启动一个 bridge，从标准输入逐行读取 JSON，并把结果写到标准输出。Codex、OpenCode 等宿主不会因此自动获得 `chrome_*` 工具。

## 适用场景

- 验证某个端口能否配对。
- 在没有 Harness 的机器上测试 bridge 命令。
- 给其他宿主提供一个独立进程，由它自己读写 JSON。

需要原生工具注册时，要另做适配器。本仓库不包含 MCP 服务。

## 启动

在仓库根目录运行：

```sh
DSH_CHROME_USE_PORT=18793 node scripts/dev.mjs
```

未设置 `DSH_CHROME_USE_PORT` 时，运行器先试上次成功的端口，再试 18791、18793..18799，并跳过 18792；设置时严格使用指定端口。端口 18792 留给 `scripts/fixture.mjs` 测试页，不要用于 bridge。

进程会一直运行，等待标准输入。首次使用先配对：

```json
{"action":"pair"}
```

输出里有 `pairingCode`（可能含字母，已包含端口）。在 Chrome 工具栏打开 dsh-chrome-use 扩展，粘贴配对码，点“连接”，不需要手填端口。纯数字旧版兼容码只用于 18791 的旧扩展。配对成功后，运行器会保存令牌，重启后自动重连。

## 常用命令

每行一个 JSON 对象。`args` 里的字段和 `chrome_*` 工具参数相同。

```json
{"action":"status"}
{"action":"tabs"}
{"action":"claim","args":{"tabId":123}}
{"action":"snapshot","args":{"tabId":123}}
{"action":"release","args":{"tabId":123}}
```

`tabs` 返回普通 HTTP(S) 标签页。`claim` 占用标签页，`release` 释放。点击、填写等命令必须先 `claim`。

## 测试页覆盖的功能

`node scripts/fixture.mjs` 启动 `http://127.0.0.1:18792/`，页面列出 11 组控件，结果都显示在页面上：

1. 输入、密码、contenteditable、下拉、复选、单选、滑块，以及表单变化回显。
2. 单击、双击、右键、悬停、禁用按钮、控制台日志与页面异常。
3. 键盘输入、组合键、Enter 提交。
4. HTML5 拖拽（拖动块到放置区）与鼠标按住拖动（报告位移）。
5. 普通文件选择与动态创建、未挂载到 DOM 的文件选择框。
6. alert/confirm/prompt、延迟出现的元素、慢接口 `/slow`。
7. 滚动位置报告与底部锚点。
8. 第二页、新标签页打开、下载文件 `/download`。
9. 同源 iframe：主页不加载 iframe，单独打开 `/frame` 测试（部分扩展会向含 iframe 的页面注入自己的 frame，Chrome 会因此拒绝调试）。
10. 阴影 DOM 按钮、表格、列表。
11. 三块色板，用于截图和导出 PDF 对照。

另有两个单独页面：`/forms` 含用户名和密码框，用来验证“Chrome 拒绝调试”的错误提示；`/second` 是第二页。

已知差异：独立 JSON 运行器没有宿主侧的文件保存逻辑，`screenshot` 和 `pdf` 返回的是内联 base64，不是本地文件路径；通过 Harness 插件调用时才会保存到本机目录。

## 三个 Agent 同时操作

DSH、Codex、OpenCode 各用独立端口（18791、18793、18794），互不共用一个 socket 或配对令牌。真正要保证的是“同一标签页只归一个 Agent”，这一点由扩展的标签页租约强制执行，不需要三方约定时间。

协调办法：

1. 每个 Agent 只 `claim` 自己新开的测试页，各占不同标签页；不同标签页本来就可以并行操作。
2. 各自把 `claim` 成功的 `tabId` 报给用户，由用户转给另一方做冲突测试。对方 `claim` 你的标签页应得到 `TAB_OWNED_BY_ANOTHER_HARNESS`，你 `release` 之后对方才能接管。
3. 三方是否真的同时在操作，可以独立核对：DSH 调用 `chrome_tabs` 会列出所有被调试的标签页，`attached: true` 覆盖所有 Agent 占用的页面；再让每个 Agent 在自己页面写一条可读结果，就能对照出三边都在同一时间段内活动。
4. 不要靠“同时按下回车”来造并发。跨 Harness 的并发是各自独立连接、各自占页，不是抢同一页。

## 给 Codex/OpenCode 的提示词

下面两段可以直接复制。Codex 使用 18793，OpenCode 使用 18794，两者可以同时运行。两份提示词都要求常驻子进程，不要写一行命令就关闭 stdin。

### 共享前提

- 工作目录固定为 `/Users/tao/code/dsh-chrome-use`，使用 Node.js 22 或 24，依赖已经安装（`node -e "import('ws')"` 能成功）。不要执行 `npm install` 或修改仓库。
- 测试扩展已经加载在一个独立的 Chrome 测试资料里。`node scripts/fixture.mjs` 已经运行在 `http://127.0.0.1:18792/`；不要再启动第二个 fixture。
- 扩展弹窗里的“前台模式”已经关闭。焦点是否被抢只能由用户观察，记为 MANUAL；不要为了测试主动调用 `chrome_activate`。
- 只操作自己创建或用户明确交给你的标签页。不要枚举、读取或试探私人标签页。跨 Harness 占用测试需要用户提供另一个 Harness 已占用的 tabId；没有就记 SKIP，不要猜。
- 先向常驻进程写 `{"action":"pair"}` 生成 `pairingCode`，把它交给用户粘贴到扩展弹窗。新码已包含端口，不要要求用户再填端口；不要先问用户要一个不存在的码。
- 结束时释放自己占用的标签页，只停止自己的子进程；不要停止另一个 Harness 的进程。

### Codex（只使用 18793）

> 你在做 dsh-chrome-use 的手工联调。工作目录是 `/Users/tao/code/dsh-chrome-use`；Node.js 22 或 24；依赖已经安装，不要执行 `npm install`，不要修改仓库、扩展或用户 Chrome 资料。测试扩展已加载，`node scripts/fixture.mjs` 已在 18792 运行，不要再启动第二个 fixture。扩展弹窗的“前台模式”已关闭；焦点行为只能人工观察，记 MANUAL，不要主动调用 `chrome_activate`。
>
> 用常驻子进程运行 `DSH_CHROME_USE_PORT=18793 node scripts/dev.mjs`。保持 stdin 一直打开，逐行写 JSON、逐行读输出；不要把单条命令 echo 给进程后关闭 stdin。先写 `{"action":"pair"}`，把返回的 `pairingCode` 交给用户，让用户在扩展弹窗粘贴；新码已包含端口，不要让用户手填端口。若返回里只有纯数字 `code`，说明是旧版兼容码，只在 18791 的旧扩展可用。你通过 JSON 行驱动，不要假设存在 `chrome_*` 工具或 MCP。
>
> 只操作 `http://127.0.0.1:18792/` 自己创建的两个测试页，不读取其他标签页，不上传敏感文件，不采集请求头、Cookie 或响应正文。配对后记录 `status`，然后逐项做并记录结果：
>
> 1. `snapshot` 读取页面，确认能看到 11 组控件的标题。
> 2. 填 `#name` 并点 `#greet`，确认 `#result` 出现问候。
> 3. 点 `#dbl`（双击）、`#ctx`（右键）、悬停 `#hover`，确认 `#pointer-result` 依次变化。
> 4. 往 `#keylog` 输入文字并回车，确认 `#key-result` 记录 Enter。
> 5. HTML5 拖拽：把 `#drag-source` 拖到 `#drop-zone`，确认 `#drag-result` 显示成功；再用鼠标拖动 `#mousedrag`，确认报告位移。
> 6. 文件上传：给自己在临时目录写一个纯文本文件，用 `#file` 上传，确认 `#upload-result` 显示 1 个文件；再用 `#file-detached` 走动态创建的选择框，确认显示“动态上传”。
> 7. 点 `#alert`、`#confirm`、`#prompt`，用对话框接口处理，确认 `#dialog-result` 有结果。
> 8. 点 `#delayed`，用等待接口等 `#appears` 出现；点 `#slow`，等网络空闲后确认 `#network-result` 有响应。
> 9. 滚动到 `#scroll-target`，点 `#scroll-report`，确认 `#scroll-result` 有位置值。iframe 限制用单独页面 `/frame` 验证，主页不加载 iframe。
> 10. 截图一次，确认返回本地路径；导出 PDF 一次，确认文件存在。
> 11. 点阴影 DOM 里的按钮（先在 `snapshot` 里找到它的 ref），确认阴影结果变化。
> 12. 打开第二个测试页并 `claim`，在上面填 `#name`，确认两个页面互不影响。
> 13. 刷新其中一个页面，确认旧 ref 失效后重新 `snapshot` 还能继续操作。
>
> 跨 Harness 测试：请用户提供一个 OpenCode 已占用的 tabId，向它发送 `claim`，预期 `TAB_OWNED_BY_ANOTHER_HARNESS`。不要枚举或猜测 tabId；用户不提供就记 SKIP。最后释放自己占用的标签页，只停止 18793 进程，不停止 18794。逐项报告 PASS/FAIL/SKIP/MANUAL、原始错误和端口，不要编造结果。

### OpenCode（只使用 18794）

> 你在做 dsh-chrome-use 的手工联调。工作目录是 `/Users/tao/code/dsh-chrome-use`；Node.js 22 或 24；依赖已经安装，不要执行 `npm install`，不要修改仓库、扩展或用户 Chrome 资料。测试扩展已加载，`node scripts/fixture.mjs` 已在 18792 运行，不要再启动第二个 fixture。扩展弹窗的“前台模式”已关闭；焦点行为只能人工观察，记 MANUAL，不要主动调用 `chrome_activate`。
>
> 用常驻子进程运行 `DSH_CHROME_USE_PORT=18794 node scripts/dev.mjs`。保持 stdin 一直打开，逐行写 JSON、逐行读输出；不要把单条命令 echo 给进程后关闭 stdin。先写 `{"action":"pair"}`，把返回的 `pairingCode` 交给用户，让用户在扩展弹窗粘贴；新码已包含端口，不要让用户手填端口。若返回里只有纯数字 `code`，说明是旧版兼容码，只在 18791 的旧扩展可用。你通过 JSON 行驱动，不要假设存在 `chrome_*` 工具或 MCP。
>
> 只操作 `http://127.0.0.1:18792/` 自己创建的两个测试页，不读取其他标签页，不上传敏感文件，不采集请求头、Cookie 或响应正文。配对后记录 `status`，然后逐项做并记录结果：
>
> 1. `snapshot` 读取页面，确认能看到 11 组控件的标题。
> 2. 填 `#name` 并点 `#greet`，确认 `#result` 出现问候。
> 3. 点 `#dbl`（双击）、`#ctx`（右键）、悬停 `#hover`，确认 `#pointer-result` 依次变化。
> 4. 往 `#keylog` 输入文字并回车，确认 `#key-result` 记录 Enter。
> 5. HTML5 拖拽：把 `#drag-source` 拖到 `#drop-zone`，确认 `#drag-result` 显示成功；再用鼠标拖动 `#mousedrag`，确认报告位移。
> 6. 文件上传：给自己在临时目录写一个纯文本文件，用 `#file` 上传，确认 `#upload-result` 显示 1 个文件；再用 `#file-detached` 走动态创建的选择框，确认显示“动态上传”。
> 7. 点 `#alert`、`#confirm`、`#prompt`，用对话框接口处理，确认 `#dialog-result` 有结果。
> 8. 点 `#delayed`，用等待接口等 `#appears` 出现；点 `#slow`，等网络空闲后确认 `#network-result` 有响应。
> 9. 滚动到 `#scroll-target`，点 `#scroll-report`，确认 `#scroll-result` 有位置值。
> 10. 截图一次，确认返回本地路径；导出 PDF 一次，确认文件存在。
> 11. 点阴影 DOM 里的按钮（先在 `snapshot` 里找到它的 ref），确认阴影结果变化。
> 12. 打开第二个测试页并 `claim`，在上面填 `#name`，确认两个页面互不影响。
> 13. 刷新其中一个页面，确认旧 ref 失效后重新 `snapshot` 还能继续操作。
>
> 跨 Harness 测试：请用户提供一个 Codex 已占用的 tabId，向它发送 `claim`，预期 `TAB_OWNED_BY_ANOTHER_HARNESS`。不要枚举或猜测 tabId；用户不提供就记 SKIP。最后释放自己占用的标签页，只停止 18794 进程，不停止 18793。逐项报告 PASS/FAIL/SKIP/MANUAL、原始错误和端口，不要编造结果。

单 Agent 同时运行 18793 和 18794 只适合快速联调，不替代两个宿主同时运行的验收。

## 给其他宿主接入

宿主需要自己启动这个进程，并保持标准输入打开。每写一行 JSON，就读取一行输出。配对信息按端口保存在 `~/.dsh/dsh-chrome-use/port-18793/`。

这是一种进程级联调方式。它不提供 MCP 工具名、参数 schema 或模型侧工具发现。宿主不能把它当成已安装的 `chrome_*` 工具。
