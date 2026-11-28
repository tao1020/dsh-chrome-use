# 更新日志

## [0.19.0] - 2026-11-29

### 新增

- `chrome_snapshot` 支持 `region`（只读某个子树）、`maxElements`/`offset`（分页）并在还有内容时返回 `nextOffset`，长页面不再只能截取前 500 个元素。
- 元素失效自动重绑：ref 指向的节点被重新渲染后，扩展会按“角色 + 可访问名称”唯一匹配重试一次；快照回复里的 `healed` 报告重绑次数，仍然唯一不了才报 `STALE_ELEMENT`。
- `chrome_network` 支持 `urlContains`、`status`、`method` 过滤，长会话里不用再翻整个列表。
- 新增 `chrome_mock`：按 URL（可加 method）模拟响应或让请求失败，用于复现空态、错误态和慢接口，规则存在期间才开启拦截。
- 新增 `chrome_storage`：只读查看当前页面的 Cookie、localStorage、sessionStorage，便于确认登录态；不提供任何写入。
- 同站跨源 iframe：快照会把同站 iframe 内的元素一并列出（带 `frame=true` 和 `frameUrl`），点击、填写、选择在子框架内可用。`chrome.debugger` 拒绝 `Target` 域、`DOM.getDocument({pierce:true})` 也看不进跨域框架，所以实现走 `Page.createIsolatedWorld` + `Runtime.evaluate`，在框架自己的隔离世界里执行页面 JavaScript。跨站或沙箱 iframe（YouTube 嵌入、第三方支付/验证码）是独立进程，`Page.getFrameTree` 根本不列，扩展读不到也不会提示，需要用户自己操作。frame ref 只支持这三类动作，悬停、拖拽、上传、右键点击会明确报 `FRAME_UNSUPPORTED`，不会退化成操作主文档里的同名元素。
- 能力协商：扩展在握手和 `chrome_status` 里报告 `capabilities` / `version`，桥接层的 `status()` 返回 `missingCapabilities`，旧扩展会明确说明缺哪项能力。
- 真实 Chrome 冒烟：`npm run smoke` 用无头 Chrome 通过 `Extensions.loadUnpacked` 加载未打包扩展（Chrome 137+ 的品牌版已忽略 `--load-extension`），校验由路径推出的扩展 id、等 service worker 起来，并在 worker 里读 `chrome.runtime.getManifest().version` 与 `package.json` 比对；CI 新增 `Real Chrome smoke` 任务。
- 商店发布流水线：`npm run publish:store`（`scripts/publish-store.mjs`）通过 Chrome Web Store API 上传 `dist/` 里的 zip 并提交审核，`.github/workflows/publish-store.yml` 提供带环境审批的工作流；凭据只从环境读取。

### 修复（独立评审后）

- 分页把主文档和子框架元素放进同一个列表再切 `offset`/`limit`，`maxElements` 不会被框架元素撑破，翻页时框架元素不再每页重复，也不会出现「后面永远读不到」或 `nextOffset` 无限循环；`truncated` 只在真的还有内容时为真。
- `healed` 改为每份快照的计数，不再累计历史。
- `chrome_storage` 的 `kind` 默认值生效（默认 `cookies`），Cookie 只允许读当前标签页同源地址，避免顺手读到别的站点。
- `chrome_mock` 的规则现在递归校验（缺字段、未知字段、`status: 9999`、空 `urlContains` 都会被拒）；模拟响应失败时改为放行请求，页面不会因为一条坏规则卡死。
- 先开启拦截再写入规则，`Fetch.enable` 失败时不会留下半套 mock 状态。

### 文档

- README 增加维护者一节（冒烟、商店发布、tag 与版本一致性要求），技能正文补充分页、重绑、`chrome_mock`、`chrome_storage`、跨域框架和能力自报的用法。
## [0.18.0] - 2026-11-28

### 新增

- 「进阶：服务器地址」：Chrome 和 Harness 不在同一台机器上时（例如 Chrome 跑在局域网另一台机器的远程桌面或容器里），可以在扩展弹窗里填 Harness 所在机器的内网 IP，不用再手改源码。默认仍是本机 `127.0.0.1`，地址留空就等于默认。
- Harness 侧新增 `DSH_CHROME_USE_BIND_HOST`，默认只监听 `127.0.0.1`；设成内网 IP 才会在该地址上监听，并要求同时显式设置 `DSH_CHROME_USE_PORT`，因为自动选端口只在回环上探测。
- 扩展弹窗的替代入口：一个 Chrome 配置同时只连一个服务器地址，多台机器用多个配置或 SSH 隧道。

### 安全

- 服务器地址只接受环回和内网地址：`127.0.0.0/8`、`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`、`169.254.0.0/16`、`::1`、`fc00::/7`、`fe80::/10`；域名和公网 IP 直接拒绝，因为域名可以解析到任何地方，而这个设置决定页面内容发往哪里。
- 拒绝带前导零的 IPv4 写法。浏览器的 URL 解析器把 `010.0.0.1` 按八进制读成 `8.0.0.1`，只按十进制校验会让「只允许内网」的承诺失效；现在 `010.0.0.1`、`192.168.1.020`、`10.0.0.08` 都会被明确拒绝并提示改成十进制写法。
- 每个已保存的端口记着自己配对的那台机器，令牌只会发回给发出它的地址：换了服务器地址必须重新配对，重连和弹窗里「连接」都拨回原地址，不会把 A 机器的令牌发到 B 机器。
- 改地址是事务式的：先握手，成功后保存新地址；失败、地址写错或目标机没开，旧令牌、旧连接和留言游标都保持原样，不会因为一次笔误丢掉配对。
- IPv6 地址按 URL 解析器的规范形式校验和比较，`fd00::zz`、`fe80:`、带网卡后缀的写法会被拒绝，`fe80:0:0:0:0:0:0:1` 与 `fe80::1` 视为同一台机器。
- 桥的 `Host` 校验跟着绑定地址走：监听回环时同时接受 `127.0.0.1`、`localhost`、`[::1]` 三种写法，监听内网地址时只接受该地址。
- 扩展 CSP 的 `connect-src` 从 `ws://127.0.0.1:*` 放宽为 `ws:`，因为 CSP 无法表达网段；地址范围由弹窗校验和 Harness 侧绑定地址共同限制，默认行为不变。

### 其它

- 弹窗里没有名字的远端连接也会显示 `host:port`，不再和本机连接长得一样。
- 独立 JSON 运行器（`scripts/dev.mjs`）改用和插件相同的一套环境变量解析，`DSH_CHROME_USE_BIND_HOST` 在那里同样生效；`bridge.status()` 增加 `bindHost` 字段，远端场景下可以自查监听地址。

### 文档

- README 中英文各加一节「跨机器连接（进阶可选项，只允许内网）」，包含 `DSH_CHROME_USE_BIND_HOST` 用法、限制和 SSH 隧道建议。
- PRIVACY.md 说明可选的服务器地址以及页面内容会发往该地址。

## [0.17.2] - 2026-11-27

### 修复

- 能力清单从 6 条扩充到 16 条，覆盖配对与连接、标签页操作、正文与结构化抽取、表单与上传、等待与断言、响应式与弱网、截图与 PDF、下载确认、控制台与网络调试、清理关闭、空闲标签页、多 Harness 留言、保持唤醒和失败自愈。原来的 6 条会让人误以为插件只有这些能力。
- 清单的说明文字从「本插件承诺的全部能力」改为「能力总览」，不再夸大范围。
- 文档检查原先在整篇 skill 正文里找关键词，渲染出来的清单行会自己满足自己，比如「空闲标签页自动关闭」这一条的关键词就藏在标题里，删掉正文解释测试仍然通过。现在只检查清单之后的正文，并且要求关键词不能是标题的一部分。

## [0.17.1] - 2026-11-26

### 变更

- 插件自带的 skill 新增「能力清单」小节，把本插件对 agent 承诺的能力逐条列出：标签页读取与操作、`@` 选中的标签页引用、右键复制标签页引用、多 Harness 留言、空闲标签页自动关闭、失败后的结构化自愈指引。agent 装插件后能直接看到这些能力，不用去读 `CHANGELOG.md`。
- 「操作流程」第 2 条补充右键复制的用法：用户在标签页上右键「复制 DSH Chrome Use 引用」后粘贴，效果等同于用 `@` 选中标签页。
- `npm test` 新增检查：能力清单里每一项都必须在 skill 正文里被解释，否则测试失败并指出缺了哪个关键词。以后只发功能、不写 skill 文档会被 CI 拦住。

## [0.17.0] - 2026-11-26

### 新增

- Chrome 标签页右键菜单新增「复制 DSH Chrome Use 引用」：点一下就把该标签页的引用写进系统剪贴板，粘到 DSH 输入框里即可引用这个 tab，模型收到的内容和用 `@` 选标签页相同。引用同样是一行 `[Chrome 标签页 #123] 《标题》 网址` 加一条 `---` 分隔线；复制本身不需要先配对，也不占用标签页。
- 扩展新增 `contextMenus`、`offscreen` 和 `clipboardWrite` 权限：`contextMenus` 只注册这一项菜单；`offscreen` 和 `clipboardWrite` 只在点击复制时把这一条引用写进剪贴板。扩展没有申请 `clipboardRead`，不能读取剪贴板内容。

### 文档

- README（中/英）增加右键复制引用的说明。
- `PRIVACY.md` 和 `CHROMEWEBSTORE.md` 同步新增权限和剪贴板数据说明。

## [0.16.2] - 2026-11-26

### 变更

- `npm run check` 现在会扫描已提交的文本文件，发现合并冲突标记（`<<<<<<<`、`=======`、`>>>>>>>`）就让检查失败，并按 `文件:行号` 报出每一处，提示解决冲突后再提交。`node_modules`、`dist`、`lib` 等构建目录和二进制文件会跳过，避免误报。

## [0.16.1] - 2026-11-26

### 修复

- `chrome_claim` 被另一个扩展的 `chrome-extension://` 内嵌 frame 拦住时，错误信息会列出这些 frame 的 URL、frameId、parentFrameId 和扩展 ID，并给出 `chrome://extensions/?id=...` 方便定位；读不到 frame 树时会说明原因。Chromium 只要页面里任意一个 frame 属于别的扩展就拒绝 DevTools attach，不需要整页被接管。
- Chrome 主动 detach（例如 `target_closed`）不再立刻释放标签页租约：标签页还在、只是调试目标被丢弃或窗口被移动时，原会话保留 ownership，可重新 claim，其他会话仍然拿不到；标签页真的消失或主动 release 时才释放。
- detach 提示会翻译原因（DevTools 打开了、别的扩展抢占了调试器、用户取消了调试提示、标签页被关闭），标签页由本扩展关闭时还带上关闭方：`idle`、`chat <port>`、`cleanup <port>`、`disconnect <port>`。
- `chrome_doctor` 在标签页尚未 attach 时不再只报 `TAB_NOT_ATTACHED`：会返回标签页是否存在、是否已被 Chrome discard、能读到的其他扩展 frame 列表和下一步说明。

### 文档

- `docs/chrome-session-debugging.md` 补充 frame 诊断、租约保留和 detach 原因说明。

## [0.16.0] - 2026-11-24

### 新增

- 输入框支持用 `@` 选标签页：打 `@` 后菜单多出「Chrome 标签页」一组，列出本机 Chrome 里所有 http/https 页面（标题和网址），选中后消息里只多一行「[Chrome 标签页 #123] 《标题》 网址」，并用一条 `---` 分隔线和你自己写的话隔开。模型不用再靠 chrome_tabs 从标题里猜目标页面，少一次工具调用，也不会认错同标题的两个窗口。
- 选中标签页后仍然要先 `chrome_claim` 占用：一个标签页同时只归一个会话，多个 Harness 并存的规则不变。「先 claim、再 snapshot、TAB_NOT_OWNED 怎么办」这些说明写在运行期 skill 和 `chrome_claim` 的工具描述里，不再每次塞进用户消息，所以发送出来的内容保持一行，不会变成一大段提示词。
- 扩展没连接、浏览器正忙或读取超时时，`@` 菜单只显示一行可点击的提示（例如去设置页拿配对码），不影响文件、会话等其他 `@` 候选。发送时序列化失败会降级成只带 tabId 的引用，不会卡住发送。
- 设置页的只读服务新增 `list` 方法，供 `@` 菜单读取标签页。它只读列表，不占用标签页租约，也不会打断正在执行的工具调用。

### 文档

- README 增加「在对话里 @ 一个标签页」一节（中英文各一份）。
- 运行期 skill 说明：用户消息里出现 `[Chrome 标签页 #123]` 时直接用该 tabId，不要再用 chrome_tabs 猜页面。

## [0.15.1] - 2026-11-23

### 修复

- 修复运行期技能加载失败：技能对象缺少 DSH 技能契约要求的 `source` 字段，注册阶段能进入技能目录，加载时却报 `loaded skill "dsh-chrome-use" source must be a string`。现在补上 `source: 'runtime'`，安装插件后该技能可以正常加载。
- 增加回归测试，覆盖加载阶段对 `source` 字符串的要求。
- 增加构建产物校验：`npm run check` 现在会确认 `src/client.js` 与源码及 `package.json` 版本同步，避免发布时才被 publish workflow 的 `git diff --exit-code` 拦住。

## [0.15.0] - 2026-11-19

### 新增

- 自动关闭空闲标签页（默认关闭）：打开扩展弹窗的开关后，本会话用 chrome_open 打开、已经 release、并且超过设置的空闲时间（默认 30 分 0 秒，可设置 1 秒到 600 分钟）没有 Agent 操作的页面会自动关闭，避免任务结束后留下无人使用的标签页。每次对该页执行命令都会重新计时；还在调试、被 claim、用户自己打开的页面和其他 Harness 的页面都不会被自动关闭。
- 扩展弹窗增加「空闲标签页」开关，默认不勾选；勾选后才会自动关闭，取消后仍可用 chrome_cleanup 手动清理。旁边可以填分钟和秒，默认 30 分 0 秒，范围 1 秒到 600 分钟。自动关闭只处理 HTTP(S) 页面，不显示网页的 beforeunload 提示。
- 后台用 chrome.storage.session 记录活动时间，用 chrome.alarms 每分钟检查；扩展重载或 Service Worker 重启后仍能继续计时，浏览器完全退出后会清空记录。debugger 仍连接时不会误关。

### 文档

- 运行期 skill 指南补充空闲标签页的边界、计时和弹窗开关。

版本号遵循语义化版本。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。
扩展版本和 Harness 插件版本始终一起发布，数字保持一致。

## [0.14.0] - 2026-11-18

### 新增

- chrome_close 默认直接关闭标签页，不显示网页的 beforeunload 提示（例如“离开此网站？系统可能不会保存您所做的更改。”）。关闭时优先用 Target.closeTarget，不触发页面的离开确认；目标不可用时回退到 tabs.remove 并自动确认。传 force=false 可以让单个调用保留手动确认；返回值增加 forcedBeforeUnload，表示这次是否启用了强制关闭。
- chrome_cleanup 和 WebSocket 断开时的自动清理也使用同一规则；如果标签页已经 release，会短暂 attach 一次以便接收提示，再关闭。
- 扩展弹窗增加“关闭时不再确认”，默认勾选。勾选时 Agent 直接关闭，取消勾选后保留页面提示，由用户选择离开或取消；修改立即生效，无需重新连接。该设置只影响 Agent 主动关闭，不影响用户自己点关闭。

### 文档

- 运行期 skill 指南补充关闭时的默认行为、force=false 和扩展弹窗开关。

## [0.13.0] - 2026-11-18

### 新增

- chrome_keep_awake：长时间浏览器任务开始前调用，让 macOS 不因空闲息屏或空闲锁屏而中断。默认保持 30 分钟，可传 1-480 分钟；再次调用会续期，off=true 立即停止，Harness 退出时自动结束。
- 使用 `/usr/bin/caffeinate` 并绑定当前 Harness 进程，既不会在 Harness 崩溃后一直唤醒，也不会覆盖手动锁屏、合盖或公司电源策略。它只防止空闲锁屏，不能解锁已经锁定的屏幕。

### 文档

- 运行期 skill 指南补充 chrome_keep_awake 的调用时机、续期、停止和限制。

## [0.12.0] - 2026-11-18

### 新增

- chrome_cleanup：关闭本会话用 chrome_open 打开的标签页，避免一个任务结束后留下几十个标签页。dryRun=true 可以先看会关哪些，keep=[tabId] 保留指定的页面；只关本会话自己打开的页面，不会关用户自己打开的页面、只是 claim 的页面或其他会话的页面。任务结束时显式调用一次即可。
- WebSocket 断开时自动做同样的清理：只关闭本会话用 chrome_open 打开的标签页，用户自己打开的页面和其他会话的页面保持原样；重连不会误关。
- chrome_tabs 的输出增加 windowId，方便区分不同 Chrome 窗口里的标签页。

### 文档

- 运行期 skill 指南补充 chrome_cleanup、断线自动清理和「只清理自己打开的页面」的边界。

## [0.11.0] - 2026-11-18

### 新增

- chrome_emulate：不改 DOM，只改当前标签页的渲染条件。支持视口尺寸和 mobile（width/height 必须一起给）、deviceScaleFactor、colorScheme（light/dark）、reducedMotion、forcedColors、network（offline/slow-3g/fast-3g/online）、cpuThrottlingRate（1-20）、timezone 和 locale。用于响应式、深色模式、弱网/离线、慢设备和本地化检查；布局、媒体查询、页面脚本和截图都会跟着变。
- 每次调用只更新传入的字段，其余保持；chrome_emulate reset=true 清除全部。覆盖只在当前占用期间有效，chrome_release 或断开时会自动恢复，避免把用户的标签页留在手机尺寸或离线下。chrome_doctor 会显示当前覆盖。
- 部分 CDP 调用失败时会先清掉已经生效的覆盖，再返回 EMULATION_FAILED，避免留下半套设置。部分页面只在加载时读取设置，需要 chrome_history action=reload 后再生效。

### 文档

- 运行期 skill 指南补充 chrome_emulate 的用法、reset 和重载说明。

## [0.10.0] - 2026-11-13

### 新增

- chrome_doctor：页面健康检查。不传 tabId 时报告连接、端口、扩展版本、插件版本和部署允许的工具；传 tabId 时再报告页面 URL、文档就绪状态、弹窗、验证码/人机校验、旧 ref、已执行动作数、控制台错误和未完成请求。不能确定为什么点不动时先查它。
- chrome_wait_response：等待某次网络响应（urlContains、method、status 组合），可读取响应体，替代「反复轮询 chrome_network」。
- chrome_assert：确认页面满足某个条件（元素可见/消失、选择器、文字、网址、predicate、networkIdle），默认立即返回，可短暂轮询；不满足时返回 ASSERT_FAILED，避免下一步靠猜。
- chrome_content：按 selector 读取一块页面正文，输出 markdown、纯文本、HTML 或 JSON 大纲，maxChars 限制长度。
- chrome_scrape：用 `name: selector` / `name: selector@attr` 字段表静态抽取结构化数据；给容器 selector 时逐容器重复。
- 同源 iframe 与 open shadow DOM 支持：快照/查找会给子框架元素标 frame=true，点击和填写的坐标会自动换算到顶层视口；content、scrape、wait、assert 的选择器能穿透 open shadow DOM。
- 快照和 chrome_doctor 增加 challenge 字段，识别 Cloudflare、reCAPTCHA、hCaptcha、Turnstile 等验证码/人机校验，提示交给用户处理。
- 动作历史：chrome_history 不传 action 时列出本会话在该标签页执行过的工具、目标、是否可能已发送输入和失败码；不记录输入文字、表达式、predicate 和文件路径。

### 变更

- 所有失败都带结构化字段：错误消息第二行为 `Failure: {"code","actionSent","retry","hint"}`。actionSent 说明输入是否可能已经生效（null 表示不确定），retry 给出下一步建议（snapshot/claim/other-tab/wait/inspect/user/fix-args/fix-page/none），hint 是一句可执行的下一步说明。扩展、bridge 和工具结果三层都会保留这组字段。
- 部署可以用 DSH_CHROME_USE_ALLOWED_ACTIONS 限制可用工具（逗号分隔短名，如 snapshot,tabs,click）；设置后未列出的工具返回 ACTION_NOT_ALLOWED；诊断类工具（chrome_setup/status/pair/doctor/report）始终可用，chrome_status 和 chrome_doctor 显示允许清单。

### 文档

- 运行期 skill 指南补充新工具、结构化失败字段、同源 iframe/shadow DOM 说明和动作开关。

## [0.9.4] - 2026-11-13

### 变更

- 设置页里的 Star 提示改成和扩展弹窗一致的文案：「喜欢这个插件？点个 Star，让更多人发现它 ⭐」。

## [0.9.3] - 2026-11-12

### 新增

- 弹窗在配对码输入框下方增加「使用帮助（Help: install and pair）」链接，指向 README 的安装与配对章节，方便从 Chrome 应用商店直接安装、不知道配对码从哪来的用户找到说明。

## [0.9.2] - 2026-11-12

### 文档

- README 精简为「安装」和「多个 Harness 同时连接」两部分，去掉能力清单等后面的章节，并在下面补一版英文 README。

## [0.9.1] - 2026-11-12

### 变更

- 弹窗把 Star 提示移到标题下方、分隔线上方，打开就能看到；底部只保留「本机连接 · 不上传到插件作者的服务器」。

## [0.9.0] - 2026-11-12

### 新增

- 扩展最多保存 10 个 Harness 连接（原来 4 个）；自动端口扩展到 18791、18793..18801，仍然跳过 18792。
- 弹窗的每个连接改成独立圆角卡片，并带自己的边框和底色，条目之间不再连成一片。
- 连接失败的长错误不再直接铺在行里：状态行只显示「未连接」加一个红色「!」图标，悬停可看原因，点一下展开完整说明和「Harness 可能已离线或还没启动」的提示。
- 可以给 Harness 起显示名：启动时设置 `DSH_CHROME_USE_NAME`（例如 `Codex`），弹窗显示「Codex · 18793」；不设置就只显示端口。名字只用于显示，不影响路由。
- 连接列表超过一屏时可以滚动。

### 变更

- 弹窗标题改为「连接你的所有 Harness 与浏览器」。

## [0.8.0] - 2026-11-12

### 新增

- Harness 之间可以互相留言。新增 `chrome_send_message` 和 `chrome_messages` 两个工具：不填 `to` 是发给所有 Harness 的留言板，填端口（如 `"18793"`）只发给那个 Harness；每个连接按自己的游标读取，读过的消息不会重复出现。
- 留言由扩展统一保存，TTL 10 分钟、最多 100 条；每个连接每分钟最多发 20 条，单条最多 800 字。断开重连后 10 分钟内可以补收离线期间的消息，重载扩展不丢。
- 有新留言时，扩展会推给对应连接；Harness 在下一次任意 `chrome_*` 工具结果里看到一行未读提示，再用 `chrome_messages` 读取正文。不需要弹窗，也不改变标签页租约规则。

### 修复

- 修掉 0.7.2 文档提交里残留的合并冲突标记，恢复 0.6.8 到 0.7.2 的完整更新日志。

## [0.7.2] - 2026-11-12

### 文档

- 说明未占用标签页的两个检查层级：Harness 占用表返回 `TAB_NOT_OWNED`（可带 Chrome detach 原因后缀），扩展侧租约丢失返回 `TAB_NOT_LEASED`；验收清单按此更新。
- 补充 HTML5 拖拽源定位说明：拖拽源在快照里可能显示为 `role=group`、名称为空，应从快照上下文确认后把 `ref` 传给 `chrome_drag`，不要按名称查找，也不要把任意 `group` 当成拖拽源。

## [0.7.1] - 2026-11-12

### 变更

- 配对码有效期从 2 分钟延长到 10 分钟，生成新码仍会让旧码立即失效。
- 扩展弹窗的连接错误提示移到配对码输入框正下方，不用滚到弹窗底部才能看到。

## [0.7.0] - 2026-11-12

### 新增

- 支持多个 Harness 同时连接同一个 Chrome。每个 Harness 用独立端口，扩展分别保存配对令牌；不同 Harness 可以同时操作不同标签页。
- 扩展统一管理标签页占用。跨 Harness 争抢同一标签页时立即返回 `TAB_OWNED_BY_ANOTHER_HARNESS`，不跨 Harness 排队。
- 支持 `DSH_CHROME_USE_PORT` 自定义端口。设置时严格使用该端口；未设置时自动从上次成功端口、18791、18793..18799 中选择，跳过 18792，并记录到 `port.json`。
- 配对码改为 8 位字母数字，包含实际端口；新扩展自动识别端口。旧版纯数字兼容码仍保留给 18791 的旧扩展。

### 变更

- 扩展最多保存 4 个 Harness 端口，弹窗会列出每个端口的连接状态，可单独连接或忘记。
- 原生清理失败时，标签页进入隔离状态（`TAB_LEASE_QUARANTINED`），重载扩展后才能重新占用。
- 弹窗只保留配对码输入框和连接按钮，删掉长篇使用说明和「Harness 端口」输入框；端口由配对码携带。
- 设置页的 Star 文案改为「喜欢这个插件？去 GitHub 点个 Star」。

### 修复

- `chrome_hover` 支持 `selector` 参数；之前只接受 ref 或坐标，传 selector 会报 `HOVER_TARGET`。
- `chrome_drag` 用 `toText` 定位放置目标时，先给解析出的目标打上内部标记再投放；页面在拖拽过程中改写文字不再导致找不到目标。
- 页面跳转后清空上一个文档遗留的未完成网络请求，`wait` 的 `networkIdle` 不再被旧请求卡到超时。

## [0.6.8] - 2026-11-12

### 变更

- README 的「当前限制」从长段落改成逐条列表，每条以加粗短标签开头。只调整排版，事实和技术结论没有变化；扩展与插件功能与 0.6.7 完全相同，没有行为变化。

## [0.6.7] - 2026-11-11

### 新增

- 设置页在插件版本下方增加一行超链接：“觉得好用？点个 Star ⭐ 这对我们很重要”，点击跳到仓库主页。
- 扩展弹窗底部增加超链接：“喜欢这个插件？点个 Star，让更多人发现它 ⭐”。
- 内置技能在用户同意提交 issue 后，会再问一句要不要顺便点个 Star；只有用户同意才打开仓库页面，不代替用户点。

## [0.6.6] - 2026-11-11

### 新增

- 新增 `chrome_report`：工具意外失败、且用户同意后，生成预填的 GitHub issue 链接。内容只包含工具名、错误信息和版本（插件、扩展、系统、Node）；网址会去掉查询参数，提交由用户自己完成。
- 内置技能增加「出错时」流程：先处理可自愈的错误码（`STALE_ELEMENT`、`TAB_BUSY`、`PAGE_HIDDEN` 等），再向用户确认是否反馈，不自动提交 issue。

## [0.6.5] - 2026-11-09

### 变更

- npm 发布包现在包含本更新日志（`CHANGELOG.md` 加入发布文件清单）。
- 版本号同步到 0.6.5；扩展功能与 0.6.4 完全相同，没有行为变化。

## [0.6.4] - 2026-11-09

### 新增

- 支持页面动态创建、从未挂到 DOM 的 `input[type=file]`：先用 `chrome_click` 带 `chooser: true` 拦截文件选择框（点击前就开启拦截），再用 `chrome_upload` 带 `chooser: true` 注入文件，页面照常收到 `change` 事件。支持多文件；`cancel: true` 可主动取消；30 秒没人消费会自动取消，标签页不会卡死。
- 上传结果新增 `chooserMode`、`frameId` 和 `bytes`（文件大小由 Harness 侧读取，扩展不读文件内容）。
- 扩展弹窗新增「前台模式」开关，默认开：
  - 开：点击、输入前把浏览器窗口抬到最前，页面一定能收到输入，但会抢走当前应用的焦点。
  - 关：只在 Chrome 自己的窗口里切换当前标签页，不抢焦点；窗口被最小化或完全遮挡时返回 `PAGE_HIDDEN`，不会偷偷弹窗。

### 变更

- 点击、输入、拖拽不再无条件调用 `Page.bringToFront`。后台静默模式改用 `chrome.tabs.update` 切换当前标签页，窗口焦点保持不变。
- `chrome_upload` 的 `ref` 改为可选，新增 `chooser`、`cancel`、`timeoutMs`；`chrome_click` 新增 `chooser`。
- 跨标签页的输入锁仍然串行执行，但只负责“切当前标签页”，不再和窗口焦点有关。
- 技能文案和工具说明同步两种上传方式与两种运行模式。

### 修复

- 输入类命令取消时统一返回 `COMMAND_CANCELED`，不再泄漏 `This operation was aborted` 这类 DOMException 文案。
- `src/client.js` 的构建版本号随 package.json 同步，发布工作流的 `git diff --exit-code` 校验不会再失败。

## [0.6.2] - 2026-11-06

### 修复

- 标签页相关工具在 Chrome 拒绝调试某个页面时，返回具体标签 ID、失败阶段和地址，而不是只有一句 attach 失败。

## [0.6.0] - 2026-11-05

### 新增

- 多个 Harness 会话并行操作不同标签页：按标签页占用（`chrome_claim` / `chrome_release`）、重叠调用返回 `TAB_BUSY`、输入类操作共用一把锁。
- 读取页面正文（`format="text"` / `markdown`）、按 `requestId` 读取网络响应体、查看 Chrome 下载记录。

## [0.4.1] - 2026-11-02

### 修复

- alert/confirm/prompt 不再卡住后续操作；文本类 ref 的定位；network-idle 等待的判定。

## [0.4.0] - 2026-11-02

### 新增

- 多文件上传、网络空闲等待、页面导出 PDF。

## [0.3.0] - 2026-11-02

### 新增

- 滚动和滚动到元素、前进/后退/刷新、整页和元素截图。

## [0.2.0] - 2026-11-02

### 新增

- 第一批浏览器交互：点击（含双击、右键）、填写、按键和组合键、悬停、拖拽、下拉选择、等待页面状态、视口截图。

## [0.1.13] - 2026-11-01

- 已连接后隐藏用法说明；文档推荐 GitHub 安装，并提示 npm 镜像可能延迟。

## [0.1.12] - 2026-11-01

- 安装步骤更醒目；已连接时精简弹窗内容。

## [0.1.11] - 2026-11-01

- 修复发布工作流上传 tarball 时使用的相对路径。

## [0.1.10] - 2026-11-01

- 修复发布工作流校验 main 的方式（拉取 main 时不带 tags）。

## [0.1.9] - 2026-11-01

- 插件内置同名运行时技能 `dsh-chrome-use`，安装插件即带使用说明。

## [0.1.8] - 2026-11-01

- 未连接时设置页优先显示安装和配对步骤。

## [0.1.7] - 2026-11-01

- 改为从 Chrome 应用商店安装扩展。

## [0.1.6] - 2026-11-01

- 修复多行 `chrome_evaluate` 和 `chrome_fill` 文本被破坏的问题。

## [0.1.5] - 2026-10-28

- 新增 `chrome_close` 关闭本会话打开的标签页。
- `chrome_open` 打开的标签页自动进入同名 Chrome 标签页组。
- 设置页可以直接生成配对码。

## [0.1.2] - 2026-10-28

- 设置页加入扩展安装指引和版本检查。

## [0.1.1] - 2026-10-28

- 首个版本：持久配对、基础浏览器控制、设置页显示连接状态，并建立基于正式标签的 npm 发布流程。

## 未发布的版本号

- 0.5.0：只作为内部版本号出现，功能随 0.6.0 一起发布。
- 0.6.3：只在开发分支上使用，功能随 0.6.4 一起发布。
