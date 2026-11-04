请独立验收 dsh-chrome-use。你是测试者，只报告实测结果，不修改插件源码。仅操作你通过 chrome_open 创建的 http://127.0.0.1:18792/ 测试标签页，不读取或操作其他网站。不要创建子 Agent。浏览器操作只用本插件的 chrome_* 工具，不用其他浏览器工具或系统鼠标。

1. 调用 chrome_status。未连接时调用 chrome_pair，输出配对码，等待用户在扩展弹窗连接。测试监督者会从工具记录中看到配对码并通知用户。用 bash 的 sleep 10 和 chrome_status 每 10 秒检查一次，最多等 180 秒。不要因此直接结束任务。如果配对码过期，重新生成一次；仍未连接则报告阻塞。
2. 连接后用 chrome_open 打开测试页，记录 tabId。用 chrome_snapshot 检查标题及“测试姓名”“显示问候”等控件。导航尚未完成时最多再读取两次。确认快照没有暴露密码框的值。再用 chrome_snapshot 的 format="text" 读取一次，确认正文出现在 content 里且没有 elements；用 format="markdown" 确认标题以 # 开头。用 chrome_find 按 name="问候" 查找按钮并确认返回的 ref；再试一次 name 和 role 都不给，应报 FIND_QUERY。
3. 用 chrome_fill 向“测试姓名”输入“DeepSeek 验收 123”，用 chrome_click 点击“显示问候”。重新读取快照，确认问候文字和 isTrusted=true。保存 chrome_screenshot，报告返回路径。截图保存成功与图像理解是两个不同结论。如果当前模型声明支持图片输入，再用 inline=true 截一次视口并确认结果里有 image 字段；模型不支持时标 SKIP，不要反复重试。
4. 测试空文本清空，再填入“第二次输入”。按 Tab，确认键盘操作成功。用 chrome_scroll 向下滚动，用 chrome_evaluate 只读检查 scrollY，再滚回。
5. 点击“产生测试错误”，用 chrome_logs 检查 console.error、JavaScript 异常和 HTTP 503。网络日志不能包含测试请求的查询参数。发现日志尚未到达时，允许短暂等待后再读取一次。记录第一次 logs 返回的 nextSeq，再点一次“产生测试错误”，用 after=nextSeq 读取，确认只返回新日志。用 chrome_network 列出请求，确认 503 那条的 status 和 failed；用它的 requestId 读取响应体，报告是否拿到文本或 NETWORK_BODY_UNAVAILABLE。
6. 尝试点击“禁用按钮”，应返回 ELEMENT_DISABLED。确认页面无变化。用 chrome_evaluate 执行 throw new Error('intentional-evaluate-test')，应返回明确错误。
7. 先记录一份快照的 ref，再调用 chrome_navigate 到 /second。旧 ref 应报失效，不能误点其他元素。返回首页并重新读取快照，确认正常使用。工具可能用复合名称，但不要猜测 ref，必须使用实际快照里的值。
8. 用 chrome_release 释放自己的测试页，再直接用 chrome_claim 接管同一页，确认无需用户点击任何逐页授权按钮。重新读取快照后，再 release。
9. 调用 chrome_downloads（不带 wait），确认返回 downloads 数组；没有下载任务时数组为空是正常结果，不要伪造条目。尝试 chrome_open 的 chrome://settings/ URL，应拒绝这个不支持的页面，不创建它。

如有超时或调试冲突，先检查 chrome_status、当前测试页与前一次工具结果。不要改用其他浏览器自动化。失败操作不能盲目重复。不要要求用户重新安装；报告原始错误及复现步骤。

最后用中文输出 Markdown 报告：环境、每项 PASS/FAIL/BLOCKED、工具和关键证据、发现的问题、截图路径、总体结论。区分实际执行与推测。不能自行点击扩展弹窗时，把“手动断开连接”和弹窗按钮外观检查标为未测试，不编造结果。不要调用 chrome_tabs 暴露无关标签页，也不要读取凭据文件或输出密钥。
