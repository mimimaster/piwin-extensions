# 贡献扩展

这个仓库只存**条目**：每个扩展一个 JSON 文件，指向你自己仓库里某个固定 commit 的源码。
代码留在你的仓库，这里不收代码。

- 网页：<https://mimimaster.github.io/piwin-extensions/>（浏览、提交、发新版本）
- 条目格式：[`schema/entry.schema.json`](schema/entry.schema.json)，示例：
  [`extensions/_examples/alice/hello-piwin.json`](extensions/_examples/alice/hello-piwin.json)
- 设计记录：piwin 仓库 `docs/adr/0077-github-extension-registry.md`

## 1. 准备源码

piwin 安装时只拉取你指定的 commit，把源码原样放进不可变目录，**不运行 npm，也不运行任何脚本**。所以：

- 扩展目录里有 `index.ts`，默认导出 Pi 扩展工厂：`export default function (pi) { … }`；
  或者 `subdir` 直接指向一个 `.ts` 文件。
- `package.json`（如果有）不能有 `dependencies`。Pi 的包只做 `import type` 或放进
  `peerDependencies`；其他依赖请打包进源码。
- 不能有 `preinstall` / `install` / `postinstall` / `prepare` 脚本。
- 不能有符号链接和 `node_modules`；总大小 ≤ 5 MB，文件数 ≤ 2000。
- 仓库必须公开，commit 必须已经推送。

扩展在 piwin 里能用哪些 Pi 能力（工具、hook、对话框、状态栏、文本面板、`/` 命令），
见 piwin 仓库 `docs/guides/pi-extensions.md`。

## 2. 发布新扩展

**网页（推荐）**：打开「提交扩展」，在「从仓库开始」贴上你的仓库地址 → 页面自动填好作者、
名称、简介、许可证、最新 commit、版本号和扩展路径，并用和 CI 相同的规则在浏览器里先检查一遍源码 →
按字段提示补全 → 「生成 PR 链接」→「在 GitHub 上创建 PR」。
（读取仓库用的是 GitHub 公开 API，未登录每小时 60 次；限流时可以手动填写，CI 仍会完整检查。草稿自动保存在本机浏览器。）
页面会打开 GitHub 的新建文件页，文件名和内容都已填好。你没有写权限，GitHub 会自动
fork 本仓库并替你开 PR，**PR 作者就是你**。条目太长放不进链接时，页面会把 JSON
复制到剪贴板并打开空白的新建页，粘贴即可。

**手动**：fork 本仓库，新建 `extensions/<你的 GitHub 用户名>/<扩展名>.json`，运行
`npm run format`，提 PR。

规则：

- `<扩展名>` 只用小写字母、数字和 `-`；扩展 id 是 `<用户名>/<扩展名>`，由路径决定。
- 放在组织名下（`extensions/<组织>/…`）时，你必须**公开**显示为该组织成员。
- `owners` 必须包含你自己（网页会自动加上）。只有 `owners` 里的人以后能改这个条目。

## 3. 发新版本

网页：打开扩展详情 →「我是作者：发新版本 / 撤回版本」→ 点「用最新 commit」（自动读取默认分支的最新
commit 和 package.json 版本号，并检查源码），或手动填版本号和 commit → 生成 →
复制完整 JSON →「打开 GitHub 编辑页」→ 全选粘贴 → Propose changes。
（GitHub 的编辑页不能预填内容，所以要复制粘贴。）

手动：在 `versions` 里加一项 `{ "version", "commit" }`。顺序无所谓，发布时按版本号从新到旧排序。

- 已发布的版本**不能改、不能删**：同一个 version 永远对应同一个 commit。
- 只有 `owners` 能提；CI 全绿即可合并。

## 4. 撤回版本

给那一版加 `"yanked": { "reason": "为什么" }`（网页里选「撤回某个版本」并填原因）。
撤回的版本不会出现在搜索里，piwin 也会拒绝安装；撤回不能恢复，修好后请发新版本。

## 5. 发布改装版

1. Fork 原作者的源码仓库，改完推到你自己的仓库。
2. 在**你自己的**命名空间新建条目（网页里「改装自」选原扩展和基于的版本），会写入
   `"forkOf": { "id": "<原作者>/<原扩展名>", "version": "<基于的版本>" }`。
3. 许可证：原扩展必须是允许修改的开源许可证（MIT、Apache-2.0、BSD、ISC、MPL、GPL 系列等）；
   原扩展是 copyleft（GPL / LGPL / AGPL / MPL）时，改装版必须用**同一个**许可证。
4. PR 里写清楚和原版的区别。CI 评论会贴出原版和改装版两个 commit 的链接，方便对照。

改装版在 piwin 里装成独立扩展（`alice-x` 与 `yorick-x`），和原版互不覆盖。

## CI 检查什么

`validate submission` 在 `pull_request_target` 上运行：只检出目标分支，用 GitHub API
把你 PR 里改的文件当作数据读取，**不执行 PR 里的任何东西**；结果写成 PR 评论并体现在 check 状态上。

- 只改了 `extensions/<owner>/<name>.json`；JSON 为 2 空格缩进 + 结尾换行；
- 字段合法（与 piwin 客户端的解析规则一致，见 `schema/fixtures/`）；
- 所有权：新条目在你自己的用户名/组织下；改已有条目的人在它原来的 `owners` 里；
- 历史只追加：已发布版本的 commit、发布时间不变，唯一允许的改动是撤回；条目不能删除；
- 改装：`forkOf` 指向的条目和版本存在、不是自己、许可证允许；
- 源码：逐个拉取新版本的 commit（`--depth 1`，只读），检查 `index.ts`、依赖、安装脚本、符号链接和大小。

通过 CI 只说明结构合规，**不等于安全审查**；扩展在用户机器上以用户权限运行。

## 本地自测

```bash
npm test                                                        # 规则与脚本的测试
node scripts/validate-entry.mjs extensions/<you>/<name>.json    # 检查单个条目（会拉取源码）
npm run format                                                  # 规范化 JSON 格式
npm run preview                                                 # 用 fixtures 起本地站点 http://127.0.0.1:8803
```
