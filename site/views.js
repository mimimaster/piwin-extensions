// Page views: list, detail (with the maintainer panel), submit.
import { BRANCH, registryRepo } from './config.js';
import { codeLine, copyButton, copyText, externalLink, h } from './dom.js';
import {
  buildSubmission,
  buildUpdate,
  commitUrl,
  editFileUrl,
  newFileLinks,
} from './entry-builder.js';
import { latestInstallable, searchEntries } from './search.js';

const installCommand = (id, version) => `piwin extension install --registry ${id}@${version}`;

export function listView(extensions, query, onQuery) {
  const results = h('div', { class: 'results' });
  const count = h('p', { class: 'muted', 'aria-live': 'polite' });
  const renderResults = (value) => {
    const found = searchEntries(extensions, value);
    count.textContent = value.trim()
      ? `找到 ${found.length} 个扩展`
      : `共 ${found.length} 个扩展`;
    results.replaceChildren(
      ...(found.length > 0
        ? found.map(card)
        : [h('p', { class: 'empty' }, value.trim() ? '没有匹配的扩展。' : '还没有扩展，来提交第一个吧。')]),
    );
  };
  const input = h('input', {
    type: 'search',
    class: 'search',
    placeholder: '搜索扩展：名称、作者、关键词…',
    value: query,
    'aria-label': '搜索扩展',
    autofocus: true,
  });
  input.addEventListener('input', () => {
    renderResults(input.value);
    onQuery(input.value);
  });
  renderResults(query);
  return h(
    'section',
    {},
    h('div', { class: 'hero' },
      h('h1', {}, 'piwin 扩展仓库'),
      h('p', { class: 'muted' }, '社区 Pi 扩展。每个版本固定到作者仓库的一个 commit，piwin 只拉取该 commit，不运行 npm 或安装脚本。'),
    ),
    input,
    count,
    results,
  );
}

function card(entry) {
  const latest = latestInstallable(entry);
  return h(
    'a',
    { class: 'card', href: `#/ext/${entry.id}` },
    h('div', { class: 'card-head' },
      h('strong', {}, entry.name),
      entry.forkOf ? h('span', { class: 'badge fork' }, '改装') : null,
    ),
    h('div', { class: 'meta' }, `${entry.id} · v${latest.version} · ${entry.license}`),
    entry.description ? h('p', {}, entry.description) : null,
  );
}

export function detailView(entry, extensions) {
  if (!entry) {
    return h('section', {}, h('h1', {}, '没有这个扩展'), h('a', { href: '#/' }, '返回列表'));
  }
  const latest = latestInstallable(entry);
  const base = entry.forkOf ? extensions.find((item) => item.id === entry.forkOf.id) : undefined;
  const baseVersion = base?.versions.find((version) => version.version === entry.forkOf.version);
  return h(
    'section',
    { class: 'detail' },
    h('a', { href: '#/', class: 'back' }, '← 全部扩展'),
    h('h1', {}, entry.name),
    h('div', { class: 'meta' }, entry.id),
    entry.description ? h('p', { class: 'lead' }, entry.description) : null,
    h('dl', { class: 'facts' },
      fact('作者 / owners', entry.owners.join(', ')),
      fact('许可证', entry.license),
      fact('源码', externalLink(entry.repository, entry.repository.replace('https://github.com/', ''))),
      entry.subdir ? fact('子目录', h('code', {}, entry.subdir)) : null,
      entry.homepage ? fact('主页', externalLink(entry.homepage, entry.homepage)) : null,
      entry.keywords?.length ? fact('关键词', entry.keywords.join(' · ')) : null,
      entry.forkOf
        ? fact(
            '改装自',
            h('span', {},
              base ? h('a', { href: `#/ext/${base.id}` }, entry.forkOf.id) : entry.forkOf.id,
              ` ${entry.forkOf.version}`,
              baseVersion ? [' · ', externalLink(commitUrl(base, baseVersion.commit), '原版源码')] : null,
            ),
          )
        : null,
    ),
    latest
      ? h('div', { class: 'install' },
          h('h2', {}, '安装'),
          h('p', { class: 'muted' }, '桌面端：扩展市场里搜索名称。命令行：'),
          codeLine(installCommand(entry.id, latest.version)),
          codeLine(`piwin extension enable ${entry.id.replace('/', '-')}`),
        )
      : h('p', { class: 'notice' }, '所有版本都已撤回，暂时不能安装。'),
    h('h2', {}, '版本'),
    versionsTable(entry),
    maintainerPanel(entry),
  );
}

function fact(label, value) {
  return [h('dt', {}, label), h('dd', {}, value)];
}

function versionsTable(entry) {
  return h(
    'table',
    { class: 'versions' },
    h('thead', {}, h('tr', {}, h('th', {}, '版本'), h('th', {}, '固定 commit'), h('th', {}, '发布时间'), h('th', {}, '状态'))),
    h('tbody', {},
      entry.versions.map((version) =>
        h('tr', { class: version.yanked ? 'yanked' : '' },
          h('td', {}, version.version),
          h('td', {}, externalLink(commitUrl(entry, version.commit), version.commit.slice(0, 12))),
          h('td', {}, version.publishedAt ? version.publishedAt.slice(0, 10) : '—'),
          h('td', {}, version.yanked ? `已撤回：${version.yanked.reason}` : '可安装'),
        ),
      ),
    ),
  );
}

/** Owners publish a version or yank one: generate the file, copy, paste on GitHub. */
function maintainerPanel(entry) {
  const repo = registryRepo();
  const fields = {
    version: h('input', { placeholder: '例如 1.3.0', 'aria-label': '新版本号' }),
    commit: h('input', { placeholder: '完整 40 位 commit SHA', class: 'mono', 'aria-label': '新版本 commit' }),
    stampDate: h('input', { type: 'checkbox', checked: true }),
    yankVersion: h('select', { 'aria-label': '撤回版本' },
      h('option', { value: '' }, '不撤回'),
      entry.versions.filter((version) => !version.yanked).map((version) => h('option', { value: version.version }, version.version)),
    ),
    yankReason: h('input', { placeholder: '撤回原因', 'aria-label': '撤回原因' }),
  };
  const output = h('div', { class: 'output' });
  const generate = () => {
    const result = buildUpdate(entry, {
      version: fields.version.value,
      commit: fields.commit.value,
      stampDate: fields.stampDate.checked,
      yankVersion: fields.yankVersion.value,
      yankReason: fields.yankReason.value,
    });
    output.replaceChildren(...resultBlock(result.problems, result.text, [
      copyButton('复制完整 JSON', result.text),
      externalLink(editFileUrl(repo, entry.id), '打开 GitHub 编辑页 ↗', 'button'),
    ], 'GitHub 编辑页不能预填内容：打开后全选，粘贴上面的 JSON，再点 "Propose changes"。只有 owners 里的账号提的 PR 会通过检查。'));
  };
  return h(
    'details',
    { class: 'panel' },
    h('summary', {}, '我是作者：发新版本 / 撤回版本'),
    h('div', { class: 'form-grid' },
      label('新版本号', fields.version),
      label('新版本 commit', fields.commit),
      h('label', { class: 'inline' }, fields.stampDate, ' 写入发布时间'),
      label('撤回某个版本', fields.yankVersion),
      label('撤回原因', fields.yankReason),
    ),
    h('button', { type: 'button', class: 'button', onClick: generate }, '生成更新后的条目'),
    output,
  );
}

export function submitView(extensions) {
  const repo = registryRepo();
  const input = (placeholder, attributes = {}) => h('input', { placeholder, ...attributes });
  const fields = {
    owner: input('你的 GitHub 用户名或组织', { required: true, autocomplete: 'username' }),
    slug: input('例如 git-autopilot', { required: true }),
    name: input('显示名称', { required: true }),
    description: h('textarea', { rows: 2, placeholder: '一句话说明它做什么' }),
    repository: input('https://github.com/<owner>/<repo>', { required: true }),
    subdir: input('可选：扩展所在目录或 .ts 文件'),
    license: input('例如 MIT', { list: 'licenses', required: true }),
    keywords: input('可选：用逗号分隔'),
    homepage: input('可选：https://…'),
    extraOwners: input('可选：其他维护者的 GitHub 用户名，逗号分隔'),
    version: input('例如 1.0.0', { required: true }),
    commit: input('完整 40 位 commit SHA', { required: true, class: 'mono' }),
    stampDate: h('input', { type: 'checkbox', checked: true }),
    forkId: h('select', {}, h('option', { value: '' }, '不是改装版'),
      extensions.map((entry) => h('option', { value: entry.id }, `${entry.id}（${entry.name}）`))),
    forkVersion: h('select', { disabled: true }),
  };
  fields.forkId.addEventListener('change', () => {
    const base = extensions.find((entry) => entry.id === fields.forkId.value);
    fields.forkVersion.replaceChildren(
      ...(base?.versions ?? []).map((version) => h('option', { value: version.version }, version.version)),
    );
    fields.forkVersion.disabled = !base;
  });
  const output = h('div', { class: 'output' });
  const submit = (event) => {
    event.preventDefault();
    const values = Object.fromEntries(
      Object.entries(fields).map(([key, element]) => [key, element.type === 'checkbox' ? element.checked : element.value]),
    );
    const result = buildSubmission(values, extensions);
    const links = newFileLinks(repo, result.owner, result.name, result.text);
    const actions = links.prefilledUrl
      ? [
          externalLink(links.prefilledUrl, '在 GitHub 上创建 PR ↗', 'button'),
          copyButton('复制 JSON', result.text),
        ]
      : [
          h('button', {
            type: 'button',
            class: 'button',
            onClick: async () => {
              await copyText(result.text);
              window.open(links.emptyUrl, '_blank', 'noopener');
            },
          }, '复制 JSON 并打开 GitHub 新建页'),
        ];
    const note = links.prefilledUrl
      ? `将打开 GitHub 新建文件页（extensions/${result.owner}/${result.name}.json，已预填）。你没有写权限时，GitHub 会自动 fork 并替你开 PR，PR 作者就是你。`
      : `条目太长（${links.length} 字符），无法放进链接。JSON 已复制到剪贴板：在打开的页面里粘贴，然后提交 PR。`;
    output.replaceChildren(...resultBlock(result.problems, result.text, actions, note));
    if (links.prefilledUrl) output.dataset.prefilledUrl = links.prefilledUrl;
  };
  return h(
    'section',
    { class: 'submit' },
    h('h1', {}, '提交扩展'),
    h('p', { class: 'muted' },
      '这里只生成条目文件，代码留在你自己的仓库。提交前请确认：该 commit 已推送到公开仓库；扩展目录有 index.ts；package.json 没有 dependencies 和安装脚本。',
      ' 完整规则见 ', externalLink(`https://github.com/${repo}/blob/${BRANCH}/CONTRIBUTING.md`, 'CONTRIBUTING'), '。'),
    h('form', { class: 'form-grid', onSubmit: submit },
      label('发布到（GitHub 用户名或组织）', fields.owner),
      label('扩展标识（小写、数字、-）', fields.slug),
      label('显示名称', fields.name),
      label('简介', fields.description),
      label('源码仓库', fields.repository),
      label('子目录', fields.subdir),
      label('许可证（SPDX）', fields.license),
      label('关键词', fields.keywords),
      label('主页', fields.homepage),
      label('其他维护者', fields.extraOwners),
      label('首个版本号', fields.version),
      label('版本 commit', fields.commit),
      h('label', { class: 'inline' }, fields.stampDate, ' 写入发布时间'),
      label('改装自', fields.forkId),
      label('基于的版本', fields.forkVersion),
      h('button', { type: 'submit', class: 'button' }, '检查并生成'),
    ),
    h('datalist', { id: 'licenses' },
      ['MIT', 'Apache-2.0', 'BSD-3-Clause', 'ISC', 'MPL-2.0', 'GPL-3.0-only', 'LGPL-3.0-only', 'AGPL-3.0-only', 'Unlicense']
        .map((license) => h('option', { value: license }))),
    output,
  );
}

function label(text, control) {
  return h('label', {}, h('span', {}, text), control);
}

function resultBlock(problems, text, actions, note) {
  if (problems.length > 0) {
    return [
      h('div', { class: 'problems', role: 'alert' },
        h('strong', {}, `还有 ${problems.length} 个问题（和 CI 用的是同一套规则）：`),
        h('ul', {}, problems.map((problem) => h('li', {}, problem))),
      ),
    ];
  }
  return [
    h('p', { class: 'ok' }, '✓ 通过检查'),
    h('pre', { class: 'json' }, text),
    h('div', { class: 'actions' }, actions),
    h('p', { class: 'muted' }, note),
  ];
}
