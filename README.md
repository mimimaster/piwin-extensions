# piwin 扩展仓库

piwin 的社区扩展目录。这里不存代码：每个扩展只有一个条目文件，指向作者自己的
GitHub 仓库里**固定 commit** 的源码。合并后 CI 生成 `index.json` 发布到 GitHub
Pages，piwin 市场搜索和 `piwin extension install --registry` 都读它。

- 索引：`https://mimimaster.github.io/piwin-extensions/index.json`
- 条目 Schema：`schema/entry.schema.json`
- 设计记录：piwin 仓库 `docs/adr/0077-github-extension-registry.md`

## 上架一个扩展（5 步）

1. 把扩展源码推到你自己的**公开** GitHub 仓库（格式见下文「源码要求」）。
2. 记下要发布的完整 commit SHA：`git rev-parse HEAD`（40 位，不能用 tag 或分支）。
3. Fork 本仓库，新建 `extensions/<你的 GitHub 用户名>/<扩展名>.json`：

   ```json
   {
     "$schema": "../../schema/entry.schema.json",
     "name": "Git Autopilot",
     "description": "暂存改动并生成提交信息。",
     "owners": ["alice"],
     "repository": "https://github.com/alice/git-autopilot",
     "subdir": "extension",
     "license": "MIT",
     "keywords": ["git", "commit"],
     "versions": [
       { "version": "1.0.0", "commit": "9f3c2e1d4b5a6978a1b2c3d4e5f60718293a4b5c" }
     ]
   }
   ```

4. 运行 `npm run format`（CI 要求 2 空格 JSON + 结尾换行），提 PR。
5. CI 通过后等维护者合并。合并几分钟后，piwin 里就能搜到。

`<扩展名>` 只能用小写字母、数字和 `-`。扩展 id 就是 `<用户名>/<扩展名>`，由文件路径决定。
组织账号也可以：放在 `extensions/<组织名>/` 下，前提是你**公开**显示为该组织成员。

## 条目字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | ✓ | 显示名，≤ 80 字 |
| `description` | | 一句话用途，≤ 500 字 |
| `owners` | ✓ | 允许修改此条目的 GitHub 用户名（小写）。新条目必须包含提 PR 的人 |
| `repository` | ✓ | `https://github.com/<owner>/<repo>`，不带 `.git` |
| `subdir` | | 扩展在仓库里的相对路径（目录或 `.ts` 文件）；缺省为仓库根目录 |
| `license` | ✓ | SPDX 标识，如 `MIT`、`Apache-2.0`、`GPL-3.0-only` |
| `keywords` | | 搜索关键词，≤ 20 个 |
| `homepage` | | https 链接 |
| `forkOf` | | 改装版必填：`{ "id": "<原作者>/<原扩展名>", "version": "<基于的版本>" }` |
| `versions` | ✓ | **新版本在最上面**。每项 `{ version, commit, publishedAt?, yanked? }` |

## 源码要求

piwin 会拉取指定 commit，把源码原样放进不可变 revision，**不执行 npm install，也不跑任何脚本**。
所以扩展必须是自包含的：

- 目录形式：目录里有 `index.ts`，默认导出 Pi 扩展工厂函数 `export default function (pi) { … }`。
- 单文件形式：`subdir` 直接指向一个 `.ts` 文件。
- `package.json`（如果有）**不能有 `dependencies`**。Pi 自己的包（`@earendil-works/pi-*`）
  用 `peerDependencies` 或只做 `import type`；其它依赖请打包进源码。
- 不能有 `preinstall` / `install` / `postinstall` / `prepare` 脚本。
- 不能有符号链接或提交进来的 `node_modules`；总大小 ≤ 5 MB，文件数 ≤ 2000。

扩展能在 piwin 里用到哪些 Pi 能力（工具、hook、对话框、状态栏、面板、`/` 命令），
见 piwin 仓库 `docs/guides/pi-extensions.md`。

## 发新版本 / 撤回

- **发新版本**：在 `versions` 数组**最前面**加一项新的 `{ version, commit }`，提 PR。
  只有 `owners` 里的人能改自己的条目；这类 PR CI 全绿即可合并。
- **已发布的版本不能改、不能删**：同一个 version 永远对应同一个 commit。
- **撤回**：给那一版加 `"yanked": { "reason": "为什么" }`。撤回的版本在搜索里隐藏，piwin 拒绝安装；
  撤回后不能恢复，请发新版本。

## 改装别人的扩展

1. Fork 原作者的源码仓库，改完推到你自己的仓库。
2. 在**你自己的**命名空间下新建条目：`extensions/<你>/<扩展名>.json`，填 `forkOf`。
3. 许可证规则：
   - 原扩展的 license 必须是允许修改的开源许可证（MIT、Apache-2.0、BSD、ISC、MPL、GPL 系列等）。
   - 原扩展是 copyleft（GPL / LGPL / AGPL / MPL）时，改装版必须沿用**同一个** license。
4. 在 PR 描述里写清楚和原版的区别。piwin 里会显示「基于 X 改装」，并提示用户先对比源码。

改装版和原版在 piwin 里装成两个独立扩展（`alice-git-autopilot` 与 `yorick-git-autopilot`），互不覆盖。

## CI 做了什么

`validate submission`（每个 PR）从**目标分支**运行 `scripts/validate-pr.mjs`，PR 里的内容只当数据读，
PR 无法修改评判它的脚本。检查：

- PR 只改了 `extensions/**`，文件名合法，JSON 已格式化；
- 字段合法（`scripts/lib/entry.mjs`）；
- 所有权：新条目在你自己的用户名/组织下，改已有条目的人在 `owners` 里；
- 版本历史只追加：已发布的 version → commit 不变，新版本在最前；
- 改装：`forkOf` 指向的条目和版本存在，许可证允许；
- 源码：逐个拉取新 commit，检查 `index.ts`、依赖、安装脚本、符号链接、大小。

通过 CI 表示结构没问题，**不等于安全审查**。扩展在 piwin 里以用户的系统权限运行，
piwin 安装前会向用户展示作者、commit 和改装来源。

`publish index`（合并到 main）重新校验全部条目，生成 `dist/index.json`，部署到 Pages。

## 在 piwin 里使用

- 桌面端：市场 → 搜索。来自本仓库的结果带「扩展仓库」标签，排在 npm / GitHub 结果前面。
- 命令行：

  ```bash
  piwin extension install --registry alice/git-autopilot        # 最新未撤回版本
  piwin extension install --registry alice/git-autopilot@1.0.0  # 指定版本
  piwin extension enable alice-git-autopilot
  ```

- 自建私有扩展仓库：fork 本仓库并开启 Pages，然后在运行 piwin Host 的机器上设置
  `PIWIN_EXTENSION_REGISTRY_URL=https://<you>.github.io/<repo>/index.json`。

## 维护者

- 首次启用：Settings → Pages → Source 选 **GitHub Actions**。
- 建议给 `main` 开分支保护：要求 `validate submission` 通过，要求 1 个 review。
- 新扩展人工看一眼源码再合并；owner 的版本更新 CI 全绿即可合并。
- 本地自测：`npm test`；本地生成索引：`npm run build`。
