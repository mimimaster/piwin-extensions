<!-- 一个 PR 只改一个扩展条目：extensions/<你的 GitHub 用户名>/<扩展名>.json -->

## 扩展

- 条目：`extensions/<owner>/<name>.json`
- 源码仓库：https://github.com/<owner>/<repo>
- 本次版本 / commit：`x.y.z` / `<完整 40 位 SHA>`

## 自查

- [ ] `versions` 里的 commit 是完整 40 位 SHA，并且已经 push 到公开仓库
- [ ] 扩展目录里有 `index.ts`（或 `subdir` 指向一个 `.ts` 文件）
- [ ] `package.json` 没有 `dependencies`，也没有 `preinstall` / `install` / `postinstall` / `prepare`
- [ ] 如果是改装版：填了 `forkOf`，并在下面写了改了什么
- [ ] 本地跑过 `npm run format`

## 改了什么 / 能做什么

<!-- 给使用者看的一两句话；改装版请写清楚和原版的区别 -->
