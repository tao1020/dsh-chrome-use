// A failure report contains only what the user agrees to share: the tool name,
// the error text and version information. Page content, screenshots,
// credentials and cookies never enter this module. URLs lose their query
// strings and fragments before they are included.
const ISSUE_ENDPOINT = 'https://github.com/tao1020/dsh-chrome-use/issues/new';
const MAX_ERROR = 2000;
const MAX_NOTE = 1000;
const MAX_BODY = 6000;

export function scrubText(value, limit) {
  return String(value ?? '')
    // Control characters make the issue body hard to read and can smuggle
    // terminal escapes into a copy-paste flow.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/https?:\/\/[^\s<>()"']+/gi, raw => {
      try {
        const url = new URL(raw);
        url.search = '';
        url.hash = '';
        return url.href;
      } catch { return '[invalid link removed]'; }
    })
    .trim()
    .slice(0, limit);
}

const firstLine = (text, limit) => text.split('\n')[0].replace(/\s+/g, ' ').slice(0, limit);

export function buildIssueReport({ error, tool, note, pluginVersion = 'unknown', extensionVersion = null, connected = false, platform = process.platform, nodeVersion = process.versions.node, now = new Date() }) {
  const scrubbed = scrubText(error, MAX_ERROR);
  if (!scrubbed) throw new Error('REPORT_ERROR: describe the failure first');
  const toolName = tool ? scrubText(tool, 40) : '';
  const summary = note ? scrubText(note, MAX_NOTE) : `调用 ${toolName || 'chrome_* 工具'} 时失败。`;
  const title = `[bug] ${toolName ? `${toolName} ` : ''}失败：${firstLine(scrubbed, 60)}`;
  const body = [
    '### 发生了什么',
    summary,
    '',
    '### 错误信息',
    '~~~',
    scrubbed,
    '~~~',
    '',
    '### 环境',
    `- 插件版本：${pluginVersion}`,
    `- Chrome 扩展版本：${extensionVersion ?? '未知'}`,
    `- 连接状态：${connected ? '已连接' : '未连接'}`,
    `- 系统：${platform} ${process.arch}`,
    `- Node：${nodeVersion}`,
    `- 时间：${now.toISOString()}`,
    '',
    '### 复现步骤',
    '（如果方便，请补充：你在做什么、页面类型、之前有没有重试。）',
  ].join('\n').slice(0, MAX_BODY);
  const url = `${ISSUE_ENDPOINT}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}&labels=bug`;
  return { url, title, body, note: '先检查内容，确认没有私人信息，再由你点击提交。' };
}
