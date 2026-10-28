# 发布到 npm

正式发布通过 GitHub Actions 的 `publish.yml` 执行。npm 使用 Trusted Publishing 验证工作流身份，不需要 `NPM_TOKEN`。流程使用 GitHub 托管的 Ubuntu runner、Node.js 24 和 npm 11.12.1，并授予发布任务 `id-token: write` 权限。

## npm 端配置

在 npm 的 `dsh-chrome-use` 包设置中添加 GitHub Actions Trusted Publisher，填写：

| 字段 | 值 |
| --- | --- |
| Organization or user | `tao1020` |
| Repository | `dsh-chrome-use` |
| Workflow filename | `publish.yml` |
| Environment name | `npm` |

如果界面提供 Allowed actions，允许直接执行 `npm publish`。工作流文件名只填文件名，不填 `.github/workflows/` 路径。GitHub 仓库使用同名的 `npm` 环境。

此配置位于 npm 包设置中。如果首次发布前还没有包页面，需要先完成包的首次创建，再配置绑定。不能仅修改工作流就认为 npm 已授权。首次创建方案应另行确认，不能跳过项目的发布审批规则。

按 npm 当前文档，新建的 Trusted Publisher 配置需要在两天内完成首次成功发布；请在准备好发布时配置。已有的写入 Token 不再供本流程使用，确认没有其他用途后可撤销。

## 发布步骤

1. 审核并合并发布变更到 `main`。
2. 获取最新远程引用，确认完整提交 SHA、包版本和发布范围，完成发布前检查与审批。
3. 在批准的 `main` 提交上创建 `release-v<版本>` 标签，推送后核对远程标签 SHA。不要覆盖已有标签。
4. 从该标签手动运行 `Publish npm package`，工作流本身也必须来自同一标签。
5. 工作流检查标签、包版本和 `main` 当前提交一致，再运行构建、检查、测试及打包，最后发布同一份归档。
6. 发布后检查 npm 上的版本和安装结果。已发布版本不能用新内容覆盖。

本流程不从个人分支发布，也不会因推送标签自动发布。若发布时 `main` 已前进，提交校验会失败；应重新确认发布范围，不要移动旧标签。

参考：https://docs.npmjs.com/trusted-publishers/
