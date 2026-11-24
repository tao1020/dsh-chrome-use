# 验收记录

这里记录一次真实浏览器验收的结果，用来说明各功能实际测到了什么、哪些还没覆盖，不构成对所有网站的保证。

## 环境与范围

- 时间：2026-10-28。
- 系统：macOS；浏览器：真实 Google Chrome。
- 宿主：DeepSeek Harness 0.2.1-rc.3，测试模型 `deepseek-v4.1-flash`。通过 Harness 的 headless 命令行启动独立会话，保留工具调用记录和最终报告。
- 扩展版本：0.1.1。
- 只操作测试者自己创建的本地测试页（`node scripts/fixture.mjs`，`http://127.0.0.1:18792/`），没有同时让其他 Agent 控制这些页面。

首次测试发现后台标签页收不到鼠标事件；增加 `Page.bringToFront` 后重新验收通过。0.6.3 起默认仍是前台模式，并在扩展弹窗「运行模式」里增加“前台模式”开关：关掉后不再调用 `Page.bringToFront`，改成只在 Chrome 窗口内切换当前标签页，避免抢走窗口焦点；窗口最小化时返回 `PAGE_HIDDEN`。

## 真实浏览器结果

| 项目 | 结果与证据 |
|---|---|
| 页面读取 | 正确读取测试页标题、按钮和输入框；没有返回密码明文 |
| 输入、点击 | 显示“你好，DeepSeek 验收 123”；页面记录 `isTrusted=true` |
| 清空、键盘 | 空文本清空成功；Tab 将焦点移动到问候按钮 |
| 滚动 | `scrollY` 从 0 到 600，再返回 0 |
| 截图 | 保存 PNG，121,014 字节；检查图像后确认包含问候文字和 `isTrusted=true` |
| 错误采集 | 捕获控制台错误、JavaScript 异常和 HTTP 503；网络 URL 未带测试查询参数 |
| 失败路径 | 禁用按钮报 `ELEMENT_DISABLED`；调试脚本异常报 `JAVASCRIPT_ERROR` |
| 页面导航 | 切换页面后旧元素引用报 `STALE_ELEMENT`；返回首页后仍可操作 |
| 免逐页授权 | `release` 后再次 `claim` 成功，全程无需用户点击授权 |
| 页面限制 | 拒绝 `chrome://settings/`，没有创建内部页面标签 |
| 服务重启 | 另开 Harness 进程后，第一次查询未连接，等待 10 秒后恢复；全程未调用 `chrome_pair` |
| 收尾 | 测试页已释放，最终占用列表为空 |

## 自动化与检查

Node.js 24.21.0 上，当时仓库的 22 项自动化测试全部通过，覆盖配对令牌持久化、桥接服务重启、扩展 worker 启动重连、手动断开停止重连、会话占用、取消、超时、延迟 attach 清理、页面限制、输入和日志边界。当前测试数量和覆盖范围以仓库最新代码为准（`npm test`）。

还检查了 JavaScript 语法、扩展 manifest、包版本一致性和打包文件。

## 未覆盖范围

- 浏览器验收之后新增的 worker 启动自动恢复和弹窗配对提示，只有自动化测试覆盖，尚未在重新加载后的真实 Chrome 中单独验收；真实浏览器里的手动“断开连接”按钮及弹窗外观也未单独验收。
- 复杂网站、跨域 iframe、封闭 Shadow DOM。
- Windows 或 Linux 上的真实浏览器。
- 多个 Harness 同时连接的真实并发场景（自动化测试用模拟 Chrome 接口，不能代替这一步）。

验收时扩展尚未上架 Chrome 应用商店；现在可以直接从[商店](https://chromewebstore.google.com/detail/anobmlnjdeahldefeikjdmmnckphpdhc)安装。
