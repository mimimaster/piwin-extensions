# piwin 扩展仓库

piwin 的社区扩展目录。这里不存代码：每个扩展一个条目文件，指向作者自己 GitHub 仓库里
**固定 commit** 的源码。合并到 `main` 后，CI 生成 `index.json`，和网页前台一起部署到 GitHub Pages。

- 网页：<https://mimimaster.github.io/piwin-extensions/>
- 索引：<https://mimimaster.github.io/piwin-extensions/index.json>（piwin 市场搜索和
  `piwin extension install --registry` 读这个）
- 怎么提交：[CONTRIBUTING.md](CONTRIBUTING.md)
- 怎么写 / 改造扩展：[Pi 扩展开发与 piwin 适配指南](https://docs.piwinwin.com/docs/extension-development)
- 设计记录：piwin 仓库 `docs/adr/0077-github-extension-registry.md`；接入说明：
  `docs/guides/extension-registry.md`

## 目录

| 路径 | 内容 |
|---|---|
| `extensions/<owner>/<name>.json` | 条目，一个扩展一个文件 |
| `extensions/_examples/` | 示例条目，只作文档，不会进索引，PR 不能改 |
| `schema/entry.schema.json` | 条目 JSON Schema（给编辑器用） |
| `schema/fixtures/` | 合法 / 非法样例；piwin 客户端的解析器测试用同一份 |
| `scripts/lib/entry.mjs` | 条目规则。CI、单文件检查和网页前台用的是**同一个文件** |
| `scripts/lib/source-rules.mjs` | 源码结构规则（纯函数）。CI 喂 git checkout，网页喂 GitHub 文件列表或上传的文件 |
| `scripts/validate-pr.mjs` | PR 检查（CI 用 `--github`，本地用 `--base/--head`） |
| `scripts/validate-entry.mjs` | 检查单个条目，并拉取固定 commit 检查源码结构 |
| `scripts/build-index.mjs` | 汇总条目生成 `index.json`，版本按新到旧排序 |
| `scripts/build-site.mjs` | 组装 Pages：`site/` + `lib/entry.mjs` + `index.json` + schema |
| `site/` | 纯静态前台：搜索、详情、一键发布（登录 + 拖入）、手动填写、发新版本 / 撤回 |
| `worker/` | Cloudflare Worker：OAuth 授权码换 token，不存储不记录 |
| `.github/workflows/validate.yml` | `pull_request_target`，只检出 base，结果写 PR 评论 + check |
| `.github/workflows/publish.yml` | push 到 `main`：测试 → 构建 → 部署 Pages |

不依赖任何 npm 包，Node ≥ 20 即可：`npm test`、`npm run preview`。

## 仓库设置（2026-09-27 已用 gh 配好）

以下设置已经在 `mimimaster/piwin-extensions` 上生效。自建 fork 时照着配：

1. **Pages**：Settings → Pages → Source = **GitHub Actions**，地址 `https://mimimaster.github.io/piwin-extensions/`。
2. **Actions**（Settings → Actions → General）：
   - 只允许 GitHub 官方 actions（`actions/*`）；
   - 工作流 token 默认只读（工作流里按需声明 `pull-requests: write` / `issues: write` / `pages: write`）；
   - 外部贡献者第一次提交需要批准后才运行工作流。`pull_request_target` 的工作流来自 `main` 本身，不执行 PR 里的代码。
3. **main 规则集 `protect main`**（Settings → Rules → Rulesets）：
   - 合并必须走 PR，需要 1 个批准，且必须是 Code Owner（CODEOWNERS = @mimimaster）；新提交会让旧的批准失效；
   - 必须通过 **`validate`** 检查（`validate submission` 工作流）；不要求分支与 main 保持同步，因为条目是互不相干的独立文件；
   - 禁止强推和删除分支；
   - 仓库管理员可以绕过：你改 `scripts/`、`site/` 时 `validate` 会失败（提交型 PR 只允许改 `extensions/**`），直接绕过合并即可。

## 一键发布：GitHub 登录的配置

网页的「发布扩展」让作者登录 GitHub 后拖入文件夹一键发布（ADR 0077 §5）。它需要一个 OAuth App
和一个只做授权码换 token 的 Cloudflare Worker（`worker/`）。没配置之前，页面会提示"登录配置中"，
并引导到「手动填写」。

仓库主人需要做（涉及账号凭据，脚本不代劳）：

1. **创建 OAuth App**：GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
   - Application name：`piwin 扩展仓库`
   - Homepage URL：`https://mimimaster.github.io/piwin-extensions/`
   - Authorization callback URL：`https://mimimaster.github.io/piwin-extensions/`
   - 不勾选 Enable Device Flow
   - 创建后记下 **Client ID**；点 Generate a new client secret，**Client Secret 只自己保存**。
2. **部署 Worker**（需要 Cloudflare 账号，免费版即可）：

   ```bash
   cd worker
   npx wrangler login                              # 浏览器里授权 Cloudflare
   # 把 wrangler.toml 里的 GITHUB_CLIENT_ID 填成上一步的 Client ID
   npx wrangler secret put GITHUB_CLIENT_SECRET    # 粘贴 Client Secret（只存进 Cloudflare）
   npx wrangler deploy                             # 输出 https://piwin-extensions-auth.<你的子域>.workers.dev
   ```

3. **把地址写进站点**：`site/config.js` 里 `OAUTH_CLIENT_ID` 填 Client ID，`AUTH_WORKER_URL`
   填 Worker 地址（不带结尾 `/`），推到 main，Pages 自动重新部署。

Worker 只做一件事：收到网页发来的授权码，带上 secret 向 GitHub 换 token 再原样返回；
只允许 `https://mimimaster.github.io` 跨域调用，不存储、不记录（`observability` 已关闭）。
token 只保存在用户浏览器标签页的 sessionStorage 里。

## 合并建议

- 新扩展：看一眼源码（CI 评论里有固定 commit 链接）再合并。
- owner 发新版本 / 撤回：CI 全绿即可合并。
- 改装版：对照 CI 评论里的原版和改装版链接。

## 自建私有扩展仓库

Fork 本仓库，按上面开启 Pages，然后在运行 piwin Host 的机器上设置：

```bash
PIWIN_EXTENSION_REGISTRY_URL=https://<you>.github.io/<repo>/index.json
```

网页前台会根据 `<you>.github.io/<repo>` 自动指向你自己的仓库。

