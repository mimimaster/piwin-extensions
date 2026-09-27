// Turn rule messages (English, from entry.mjs / source-rules.mjs) into a
// form field and a short Chinese hint. Unknown messages pass through.

const RULES = [
  [/^name /, 'name', '填写显示名称，最多 80 字'],
  [/^description/, 'description', '简介最多 500 字'],
  [/^owners must/, 'owner', '至少要有一位维护者'],
  [/^owner "/, 'extraOwners', '维护者要填小写的 GitHub 用户名'],
  [/^repository cannot change/, 'repository', '已发布条目的仓库不能改'],
  [/^repository/, 'repository', '要是 https://github.com/<owner>/<repo>，不带 .git 和结尾的 /'],
  [/^subdir must/, 'subdir', '填仓库里的相对路径，不能以 / 或 ./ 开头，不能含 ..'],
  [/^subdir ".*" does not exist/, 'subdir', '这个 commit 里没有这个路径'],
  [/has no index\.ts/, 'subdir', '扩展目录里没有 index.ts'],
  [/must be a \.ts module/, 'subdir', '单文件扩展必须是 .ts 文件'],
  [/^license/, 'license', '填 SPDX 许可证标识，例如 MIT'],
  [/^keyword/, 'keywords', '关键词最多 20 个，每个不超过 40 字'],
  [/^homepage/, 'homepage', '主页要是 https 链接'],
  [/^forkOf cannot name/, 'forkId', '改装来源不能是自己'],
  [/^forkOf/, 'forkId', '改装来源格式不对'],
  [/versions\[\d+\]\.version|duplicate version/, 'version', '版本号只能用字母、数字和 . + -，且不能重复'],
  [/versions\[\d+\]\.commit/, 'commit', '要完整的 40 位 commit SHA，不能用分支或 tag'],
  [/^commit .* is not in/, 'commit', '仓库里找不到这个 commit，先 push 再提交'],
  [/symbolic link/, 'source', '源码里有符号链接'],
  [/node_modules/, 'source', '不要把 node_modules 提交进仓库'],
  [/has dependencies/, 'source', 'package.json 有 dependencies：piwin 不跑 npm，请打包进源码或改成 peerDependencies'],
  [/defines a "(\w+)" script/, 'source', 'package.json 里有安装脚本 "$1"，不允许'],
  [/not valid JSON/, 'source', 'package.json 不是合法 JSON'],
  [/larger than 5 MB|more than \d+ files/, 'source', '源码超过 5 MB 或 2000 个文件'],
];

/** @returns {{ field: string, text: string }} */
export function describeProblem(message) {
  for (const [pattern, field, text] of RULES) {
    const match = pattern.exec(message);
    if (match) return { field, text: text.replace('$1', match[1] ?? '') };
  }
  return { field: 'general', text: message };
}
