// Submit form: grouped steps on the left, live entry preview on the right.
import { BRANCH, registryRepo } from './config.js';
import { copyButton, copyText, externalLink, h } from './dom.js';
import { buildSubmission, newFileLinks } from './entry-builder.js';
import { latestInstallable } from './search.js';
import { icon } from './ui.js';
import { resultBlock } from './view-result.js';

const LICENSES = ['MIT', 'Apache-2.0', 'BSD-3-Clause', 'ISC', 'MPL-2.0', 'GPL-3.0-only', 'LGPL-3.0-only', 'AGPL-3.0-only', 'Unlicense'];

export function submitView(extensions) {
  const repo = registryRepo();
  const input = (placeholder, attributes = {}) => h('input', { placeholder, ...attributes });
  const fields = {
    owner: input('你的 GitHub 用户名或组织', { required: true, autocomplete: 'username' }),
    extraOwners: input('可选，逗号分隔'),
    slug: input('git-autopilot', { required: true, class: 'mono' }),
    name: input('Git Autopilot', { required: true }),
    description: h('textarea', { rows: 3, placeholder: '一句话说明它能帮用户做什么' }),
    keywords: input('可选，逗号分隔'),
    homepage: input('可选，https://…'),
    repository: input('https://github.com/<owner>/<repo>', { required: true, class: 'mono' }),
    subdir: input('可选：extension 或 src/tool.ts', { class: 'mono' }),
    license: input('MIT', { list: 'licenses', required: true }),
    version: input('1.0.0', { required: true, class: 'mono' }),
    commit: input('完整 40 位 commit SHA', { required: true, class: 'mono' }),
    stampDate: h('input', { type: 'checkbox', checked: true }),
    forkId: h('select', {}, h('option', { value: '' }, '不是改装版'),
      extensions.map((entry) => h('option', { value: entry.id }, `${entry.id}（${entry.name}）`))),
    forkVersion: h('select', { disabled: true }, h('option', { value: '' }, '先选原扩展')),
  };
  fields.forkId.addEventListener('change', () => {
    const base = extensions.find((entry) => entry.id === fields.forkId.value);
    fields.forkVersion.replaceChildren(
      ...(base
        ? base.versions.map((version) =>
            h('option', { value: version.version }, version.yanked ? `${version.version}（已撤回）` : version.version),
          )
        : [h('option', { value: '' }, '先选原扩展')]),
    );
    // Default to the newest version people can still install.
    const installable = base ? latestInstallable(base) : undefined;
    if (installable) fields.forkVersion.value = installable.version;
    fields.forkVersion.disabled = !base;
    updatePreview();
  });

  const values = () =>
    Object.fromEntries(
      Object.entries(fields).map(([key, element]) => [key, element.type === 'checkbox' ? element.checked : element.value]),
    );
  const previewPath = h('code', {}, 'extensions/<owner>/<name>.json');
  const previewJson = h('pre', { class: 'json live' }, '{}');
  const output = h('div', { class: 'output' });

  function updatePreview() {
    const result = buildSubmission(values(), extensions);
    previewPath.textContent = `extensions/${result.owner || '<owner>'}/${result.name || '<name>'}.json`;
    previewJson.textContent = result.text;
  }

  const submit = (event) => {
    event.preventDefault();
    const result = buildSubmission(values(), extensions);
    const links = newFileLinks(repo, result.owner, result.name, result.text);
    const actions = links.prefilledUrl
      ? [
          externalLink(links.prefilledUrl, [icon('github', 16), ' 在 GitHub 上创建 PR'], 'button'),
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
          }, icon('github', 16), ' 复制 JSON 并打开 GitHub'),
        ];
    const note = links.prefilledUrl
      ? `会打开 GitHub 的新建文件页，文件 extensions/${result.owner}/${result.name}.json 已预填。你没有写权限时 GitHub 会自动 fork 并替你开 PR，PR 作者就是你。`
      : `条目太长（${links.length} 字符）放不进链接。点按钮会复制 JSON 并打开空白的新建页，粘贴后提交 PR。`;
    output.replaceChildren(...resultBlock(result.problems, result.text, actions, note));
    if (links.prefilledUrl) output.dataset.prefilledUrl = links.prefilledUrl;
    output.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const form = h('form', { class: 'submit-form', onSubmit: submit, onInput: updatePreview },
    group(1, '谁来维护', '条目放在这个 GitHub 用户名或组织下。提 PR 的账号必须在维护者里。',
      field('发布到', fields.owner, '用户名或你公开所属的组织'),
      field('其他维护者', fields.extraOwners),
    ),
    group(2, '扩展信息', '市场卡片和搜索用到的内容。',
      field('扩展标识', fields.slug, '小写字母、数字、-；id 为 发布到/扩展标识'),
      field('显示名称', fields.name),
      field('简介', fields.description, null, 'wide'),
      field('关键词', fields.keywords),
      field('主页', fields.homepage),
    ),
    group(3, '源码与版本', 'piwin 只拉取这个 commit。目录里要有 index.ts，package.json 不能有 dependencies 和安装脚本。',
      field('源码仓库', fields.repository, null, 'wide'),
      field('子目录', fields.subdir, '扩展目录或单个 .ts 文件'),
      field('许可证', fields.license, 'SPDX 标识'),
      field('版本号', fields.version),
      field('commit', fields.commit, 'git rev-parse HEAD，需已推送'),
      h('label', { class: 'check wide' }, fields.stampDate, '写入发布时间'),
    ),
    group(4, '改装（可选）', '改的是别人的扩展？选原扩展和基于的版本；copyleft 许可证要沿用原许可证。',
      field('改装自', fields.forkId),
      field('基于的版本', fields.forkVersion),
    ),
    h('div', { class: 'submit-bar' },
      h('button', { type: 'submit', class: 'button' }, icon('check', 16), '检查并生成'),
      h('span', { class: 'fine' }, '只在浏览器里检查，不会上传任何东西。'),
    ),
    h('datalist', { id: 'licenses' }, LICENSES.map((license) => h('option', { value: license }))),
  );

  updatePreview();
  return h('div', { class: 'submit' },
    h('header', { class: 'page-head' },
      h('p', { class: 'eyebrow' }, '提交扩展'),
      h('h1', {}, '把你的扩展放进仓库'),
      h('p', { class: 'hero-lead' },
        '这里只生成一个条目文件，代码留在你自己的仓库。完整规则见 ',
        externalLink(`https://github.com/${repo}/blob/${BRANCH}/CONTRIBUTING.md`, 'CONTRIBUTING'),
        '。'),
    ),
    h('div', { class: 'submit-grid' },
      h('div', {}, form, output),
      h('aside', { class: 'preview' },
        h('div', { class: 'panel' },
          h('h2', {}, '条目预览'),
          h('p', { class: 'fine' }, previewPath),
          previewJson,
        ),
      ),
    ),
  );
}

function group(index, title, hint, ...fields) {
  return h('fieldset', { class: 'group' },
    h('legend', {}, h('span', { class: 'step-index' }, String(index)), title),
    hint ? h('p', { class: 'fine' }, hint) : null,
    h('div', { class: 'form-grid two' }, fields),
  );
}

function field(text, control, hint, className) {
  return h('label', { class: `field${className ? ` ${className}` : ''}` },
    h('span', {}, text),
    control,
    hint ? h('small', {}, hint) : null,
  );
}
