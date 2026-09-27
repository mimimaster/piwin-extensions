<!-- 一个 PR 只改一个条目：extensions/<GitHub 用户名或组织>/<扩展名>.json
     最省事的方式：在 https://extension.piwinwin.com/#/submit 填表生成。 -->

## 扩展

- 条目：`extensions/<owner>/<name>.json`
- 源码仓库 / commit：https://github.com/<owner>/<repo> @ `<完整 40 位 SHA>`

## 自查

- [ ] commit 是完整 40 位 SHA，并已推送到公开仓库
- [ ] 扩展目录有 `index.ts`（或 `subdir` 指向一个 `.ts` 文件）
- [ ] `package.json` 没有 `dependencies`，也没有 `preinstall` / `install` / `postinstall` / `prepare`
- [ ] 改装版：填了 `forkOf`，下面写了改了什么

## 改了什么 / 能做什么

<!-- 一两句话给使用者看；改装版请写清楚和原版的区别 -->
