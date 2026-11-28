# Chrome Web Store 条目 — dsh-chrome-use

> Last Updated: 2026-11-26
>
> 本文件是 Chrome 应用商店（CWS）条目的唯一事实源：简介、详细描述、权限说明、数据披露、版本历史都以这里为准。更新商店条目前先改这里，再复制到开发者后台。

## 商店地址

https://chromewebstore.google.com/detail/anobmlnjdeahldefeikjdmmnckphpdhc

## Store Listing

**Extension Name**：dsh-chrome-use

**Short Description**：操纵你正在使用的 Chrome：新建或复用已登录标签页，读取页面、点击、填写、拖拽、滚动、截图，查看控制台与网络日志。多个 Agent 会话可同时操作不同标签页，同一标签页自动排队。商店安装，8 位配对码连接，自动选择可用端口。

**Detailed Description**：

操纵你正在使用的 Chrome 浏览器：让模型读取页面、点击、填写、拖拽页面元素、滚动、截图，新建标签页并分组、关闭本会话打开的标签页，查看控制台与网络日志、按需读取单条响应体、查看下载记录，调试浏览器等。多个 Agent 会话可以同时操作不同的标签页，同一标签页会排队执行。扩展从 Chrome 应用商店安装，用 8 位配对码连接；配对码可能含字母，并包含实际端口。

它把 Chrome 接到本机 DeepSeek Harness，不用复制链接，也不用重复登录；首次配对后保存连接凭据，后续自动重连。

能做什么
• 点击、双击、右键、悬停、拖拽页面元素、下拉选择
• 填写表单，按 Enter、Tab、Esc、Home、End、PageUp、PageDown，以及 meta+a、ctrl+shift+k 等组合键
• 一次上传一个或多个文件
• 等待元素出现、文字出现、网址变化或网络空闲
• 刷新、后退、前进，把标签页切到前台
• 新建标签页并放进同名标签页组；关闭本会话打开的标签页
• 滚动到指定元素，也支持内部滚动容器
• 截取视口、整页或单个元素
• 把页面导出为 PDF
• 处理 alert、confirm、prompt 对话框
• 读取页面结构、控制台、JavaScript 错误和网络状态
• 操作开放 Shadow DOM 内的元素

并发与协调
• 多个 Harness 会话（Agent）可以同时操作不同的标签页，读取、等待和截图互不阻塞
• 多个 Harness 进程可以用不同端口同时连接；每个进程独立配对，标签页占用由扩展统一协调
• 同一 Harness 内，同一标签页同一时间只执行一条命令；其他会话申请时按先来后到排队，最多等 10 秒
• 不同 Harness 之间不排队：标签页已被另一个 Harness 占用时立即返回 TAB_OWNED_BY_ANOTHER_HARNESS
• 点击、输入、拖拽、关闭、激活等会切换前台的操作自动排队，避免中途抢走焦点
• 取消或超时后，等扩展确认清理完成才释放占用；超过 8 秒仍未清理会断开连接，避免旧操作影响下一个会话
• 这些锁只协调本插件发出的操作，不能阻止你手动切换页面、其他扩展或网页脚本改变焦点

首次配对后保存连接凭据，后续自动重连。连接后，AI 可以选择所有普通 HTTP(S) 标签页，不需要逐页授权。

调试时 Chrome 会显示调试提示，点击时页面会短暂显示蓝色箭头。扩展弹窗列出每个端口的连接状态，可单独连接或忘记，也可以随时断开全部连接。

使用前需要在同一台电脑安装 DeepSeek Harness 和本仓库提供的 Harness 插件。扩展不提供模型服务，不包含模型 API Key。你选择的模型服务可能处理工具返回的网页内容。

**Category**：Developer Tools

**Single Purpose**：为用户配置的本机 DeepSeek Harness 提供 Chrome 页面操作和调试能力。

**Primary Language**：中文（简体）

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon | 128×128 PNG | ✅ Ready | `extension/icon-128.png` |
| Screenshot 1 | 1280×800 或 640×400 | 🟡 已在商店，仓库无源文件 | — |
| Screenshot 2 | 1280×800 或 640×400 | 🟡 已在商店，仓库无源文件 | — |
| Screenshot 3 | 1280×800 或 640×400 | 🟡 已在商店，仓库无源文件 | — |
| Small Promo Tile | 440×280 | ⬜ Not created | — |
| Marquee Promo Tile | 1400×560 | ⬜ Not created | — |

### Screenshot Notes

商店已有截图但没入库；下次更新条目时建议重拍，并保持三张：1）弹出窗里的连接状态和配对码输入框；2）一个真实页面上的元素高亮/点击结果；3）多个 Harness 各占一个标签页的标签组。截图不要包含真实业务数据、配对码或个人信息。

## Permissions Justification

| Permission | Type | Justification |
|---|---|---|
| `debugger` | permissions | 核心功能：通过 Chrome DevTools 协议读取页面结构、控制台和网络状态，执行点击、输入、截图等操作。只在用户通过自己的 Harness 请求操作某个标签页时附加；Chrome 会显示“正在调试此浏览器”提示，用户可随时在弹窗断开。 |
| `tabs` | permissions | 列出可用标签页供用户/AI 选择，读取目标页标题和 URL 以确认操作对象、判断标签页是否还能访问。不后台记录浏览历史。 |
| `tabGroups` | permissions | 把 `chrome_open` 新建的标签页放进同名标签页组，方便用户识别和一次性关闭。 |
| `storage` | permissions | 保存配对凭据和自动重连设置，避免每次连接都重新输入配对码。不保存页面内容。 |
| `alarms` | permissions | 在 Harness 重启或连接中断后按固定间隔尝试重连；不用于采集数据。 |
| `downloads` | permissions | 按用户要求列出下载记录，确认文件是否保存成功；不修改下载内容，也不上传文件。 |
| `webNavigation` | permissions | 仅当调试器附加失败、且 Chrome 明确提示页面里存在其他扩展的页面（`chrome-extension://`）时，读取**当前这个标签页**的 frame 列表（URL、frameId、parentFrameId），用于告诉用户是哪个扩展、哪个 frame 拦截了调试。不在其他时机读取，不记录浏览历史。 |
| `contextMenus` | permissions | 只在标签页右键菜单里增加「复制 DSH Chrome Use 引用」一项，方便用户把一个标签页的引用粘到 Harness 对话里。不修改其他菜单，也不读取菜单之外的操作。 |
| `offscreen` | permissions | 仅在你点击「复制 DSH Chrome Use 引用」时创建一个不显示界面的扩展页面，用来调用系统剪贴板；它不读取页面内容，也不会在后台自动创建。 |
| `clipboardWrite` | permissions | 只把你在菜单里主动复制的那一条标签页引用写入系统剪贴板。扩展不申请 `clipboardRead`，因此无法读取剪贴板内容。 |

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** No（扩展本身不向作者或第三方服务器传输数据）

扩展默认只连接本机 `127.0.0.1` 上的用户自己的 Harness。页面文字、标题、URL、截图和调试信息会经本机回环进入用户的 Harness 会话；之后是否发送给用户选择的模型提供方，由用户自己的 Harness 配置和模型服务政策决定，扩展不参与、也无法控制。

0.18.0 起，用户可以在弹窗的「进阶：服务器地址」里改连同一内网内的另一台机器的 Harness（例如 Chrome 跑在远程桌面上）。该字段只接受环回和内网地址，域名和公网 IP 会被拒绝；填写后页面内容会以明文 WebSocket 发往该地址，地址由用户自己输入，也可以随时清空回到默认。扩展不内置统计、广告或远程上报。

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|-----------|-----------|------------------------|---------|---------------------------|
| Personally identifiable info | No | No | — | No |
| Health info | No | No | — | No |
| Financial info | No | No | — | No |
| Authentication info | No | No | — | No |
| Personal communications | No | No | — | No |
| Location | No | No | — | No |
| Web history | No（只按请求读取当前标签页标题/URL） | No | 选择操作对象 | No |
| User activity | No（点击/输入只作用于用户指定的页面） | No | 执行用户要求的操作 | No |
| Website content | No（仅本机处理；填写进阶服务器地址后除外） | 默认 No；启用进阶服务器地址时 Yes（只发往用户指定的内网机器） | 读取页面结构、截图、控制台/网络日志 | No（不发给作者或第三方） |
| Clipboard | No（只写不读） | No | 用户点击菜单时写入一条标签页引用 | No |

### Data Use Certification

- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Privacy Policy

**Privacy Policy URL**：https://github.com/tao1020/dsh-chrome-use/blob/main/PRIVACY.md

（如果商店后台填的是别的托管地址，以后台为准，并同步更新这里。仓库内的 `PRIVACY.md` 是正文来源。）

## Distribution

**Visibility**：Public
**Regions**：All regions

## Developer Info

**Publisher Name**：tao1020

**Contact Email**：见 Chrome Web Store 开发者后台（不在仓库里公开个人邮箱）

**Support URL**：https://github.com/tao1020/dsh-chrome-use/issues

**Homepage URL**：https://github.com/tao1020/dsh-chrome-use

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 0.18.0 | 2026-11-28 | 进阶可选项：弹窗新增「服务器地址」，可连同一内网的另一台机器；只接受环回和内网 IP，默认仍是 `127.0.0.1`。CSP 的 `connect-src` 从固定回环放宽为任意 `ws:` 目标，因为 CSP 无法表达网段；实际可用地址由弹窗校验和 Harness 侧的 `DSH_CHROME_USE_BIND_HOST` 限制。 | Draft（待上传商店） |
| 0.17.0 | 2026-11-26 | 标签页右键菜单复制 DSH Chrome Use 引用；新增 `contextMenus`、`offscreen`、`clipboardWrite` 权限，只写剪贴板不读取。 | Draft（待上传商店） |
| 0.16.1 | 2026-11-26 | 调试器被其他扩展的 `chrome-extension://` frame 拦截时列出 frame 与扩展 ID，并给 `chrome://extensions/?id=` 定位；Chrome 主动 detach 但标签页还在时保留占用；detach 原因和关闭方（idle / chat / cleanup / disconnect）写进提示；`chrome_doctor` 在未附加时返回标签页状态和 frame 列表。新增 `webNavigation` 权限。 | Draft（待上传商店） |
| 0.16.0 | 2026-11-24 | 输入框 `@` 选择标签页；商店安装与自动重连保持稳定。 | Published |
| 0.15.1 | 2026-11-23 | 修复运行期 skill 加载；补构建产物校验。 | Published |
| 0.15.0 | 2026-11-19 | 自动关闭空闲标签页（默认关闭）；弹窗开关和超时设置。 | Published |

## Review Notes

### Known Issues / Limitations

- 需要 `debugger` 权限，Chrome 会在被操作的标签页顶部显示调试提示条；这是产品工作方式，不是异常。
- 不能操作 `chrome://`、Chrome 应用商店等受保护页面；这类页面会明确报错。
- 调试器附加会被页面中属于其他扩展的 `chrome-extension://` frame 阻止（Chromium 行为）。0.16.1 起会列出是哪个扩展、哪个 frame，并提示到 `chrome://extensions/?id=<id>` 禁用；这不是本扩展能绕过的限制。
- 多个 Harness 同时连接时，标签页占用由扩展统一协调；扩展重载或浏览器重启会清空占用，需要重新 claim。
- `webNavigation` 只在附加失败时按标签页读取 frame 列表，用于诊断，不用于追踪浏览历史。
- 0.18.0 放宽 `connect-src` 到 `ws:`：CSP 不能写网段，所以地址限制由弹窗校验（只允许环回和内网 IP）和 Harness 侧绑定地址共同保证；默认仍只连 `127.0.0.1`，连接仍是明文 WebSocket，用户可在弹窗里看到并清除该地址。
- 0.17.0 新增 `clipboardWrite`：只写不读，且只在用户点击标签页右键菜单时写入一条引用；不采集剪贴板内容。

### Rejection History

暂无。

## 上架状态与发布流程

扩展已在 Chrome 应用商店公开，用户可以直接从上面的商店地址安装，并由 Chrome 自动更新。

仓库发布（npm / GitHub release）不会自动更新商店版本：仓库里的版本更新后，需要把 `npm run package` 生成的 `dist/dsh-chrome-use-<version>.zip` 重新上传到商店，审核通过后用户才会收到更新。扩展包、本文件和 `PRIVACY.md` 要一起更新。

目前没有准备 Edge 商店版本。
