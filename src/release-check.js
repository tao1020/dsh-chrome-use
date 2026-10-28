export const releasesUrl = 'https://github.com/tao1020/dsh-chrome-use/releases';
export function newerVersion(latest, current) {
  const parse = value => /^\d+\.\d+\.\d+$/.test(value) ? value.split('.').map(Number) : null;
  const a = parse(latest), b = parse(current);
  if (!a || !b) throw new Error('无法识别版本号');
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
export async function checkRelease(current, fetcher = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetcher('https://api.github.com/repos/tao1020/dsh-chrome-use/releases/latest', { signal: controller.signal, credentials: 'omit', redirect: 'error', headers: { Accept: 'application/vnd.github+json' } });
    if (response.status === 404) return { message: '暂时没有正式发布的版本。' };
    if (!response.ok) throw new Error(`检查失败（HTTP ${response.status}），请稍后重试或查看发布页面。`);
    const text = await response.text();
    if (text.length > 262144) throw new Error('版本信息过大，请查看发布页面。');
    const release = JSON.parse(text);
    const version = String(release.tag_name).replace(/^release-v/, '');
    if (release.draft || release.prerelease) throw new Error('未找到稳定版本');
    return { message: newerVersion(version, current) ? `发现新版本 ${version}` : `当前已是最新版本（${current}）`, version };
  } catch (error) {
    if (controller.signal.aborted) throw new Error('检查更新超时，请重试。');
    throw error;
  } finally { clearTimeout(timer); }
}
