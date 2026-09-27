// One-click publishing: sign in, drop the extension, confirm, publish.
import { getToken } from './auth.js';
import { registryRepo, signInConfigured } from './config.js';
import { h } from './dom.js';
import { validateEntry } from './lib/entry.mjs';
import { canonicalEntry } from './entry-builder.js';
import { describeProblem } from './problem-text.js';
import { publishNewExtension, sourceRepoName } from './publish-flow.js';
import { latestInstallable } from './search.js';
import { dropzone } from './upload-dropzone.js';
import { inspectUpload } from './upload-inspect.js';
import { icon } from './ui.js';
import { accountBar, progressList, resultCard } from './view-publish-parts.js';

const LICENSES = ['MIT', 'Apache-2.0', 'BSD-3-Clause', 'ISC', 'MPL-2.0', 'GPL-3.0-only', 'LGPL-3.0-only', 'AGPL-3.0-only', 'Unlicense'];

export function uploadView(extensions) {
  let login = null;
  let upload = null;
  const stage = h('div', { class: 'upload-stage' });
  const bar = accountBar((value) => {
    login = value;
    if (upload) renderReview();
  });

  const zone = dropzone(
    (next) => {
      upload = next;
      // Files are in: the review below is the focus now.
      zone.classList.add('compact');
      renderReview();
    },
    (error) => stage.replaceChildren(h('div', { class: 'callout danger' }, icon('alert', 18), h('span', {}, error.message))),
  );

  function renderReview() {
    const inspected = inspectUpload(upload);
    const meta = { ...inspected.meta };
    const input = (key, attributes = {}) => {
      const control = h('input', { value: meta[key], ...attributes });
      control.addEventListener('input', () => {
        meta[key] = control.value;
        refresh();
      });
      return control;
    };
    const license = h('input', { value: meta.license || 'MIT', list: 'upload-licenses', spellcheck: 'false' });
    meta.license = license.value;
    license.addEventListener('input', () => {
      meta.license = license.value.trim();
      refresh();
    });
    const description = h('textarea', { rows: 2 }, meta.description);
    description.addEventListener('input', () => {
      meta.description = description.value;
      refresh();
    });
    const forkSelect = h('select', {}, h('option', { value: '' }, '不是，这是我自己写的'),
      extensions.map((entry) => h('option', { value: entry.id }, `${entry.id}（${entry.name}）`)));
    forkSelect.addEventListener('change', refresh);

    const errors = { name: h('small', { class: 'field-error' }), slug: h('small', { class: 'field-error' }), version: h('small', { class: 'field-error' }), license: h('small', { class: 'field-error' }), description: h('small', { class: 'field-error' }) };
    const field = (label, control, key, hint, wide) =>
      h('label', { class: `field${wide ? ' wide' : ''}` }, h('span', { class: 'field-label' }, label), control, hint ? h('small', { class: 'field-hint' }, hint) : null, errors[key] ?? null);
    const idLine = h('p', { class: 'fine id-line' });
    const publishButton = h('button', { type: 'button', class: 'button big' }, icon('send', 18), '一键发布');
    const blockers = h('div', { class: 'blockers' });
    const progressSlot = h('div', {});

    const sourceProblems = inspected.problems.map((problem) => describeProblem(problem).text);
    function currentIssues() {
      const forkBase = extensions.find((entry) => entry.id === forkSelect.value);
      const forkOf = forkBase ? { id: forkBase.id, version: latestInstallable(forkBase)?.version ?? forkBase.versions[0].version } : undefined;
      const owner = (login ?? 'you').toLowerCase();
      const id = `${owner}/${meta.slug}`;
      const draft = canonicalEntry({
        name: meta.name.trim(),
        description: meta.description.trim(),
        owners: [owner],
        repository: `https://github.com/${owner}/${sourceRepoName(meta.slug || 'x')}`,
        license: meta.license,
        keywords: meta.keywords,
        homepage: meta.homepage,
        forkOf,
        versions: [{ version: meta.version.trim(), commit: '0'.repeat(40) }],
      });
      const issues = validateEntry(draft, id).map(describeProblem);
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(meta.slug)) issues.push({ field: 'slug', text: '只能用小写字母、数字和 -' });
      if (login && extensions.some((entry) => entry.id === id)) issues.push({ field: 'slug', text: `${id} 已存在；发新版本请到它的详情页上传` });
      return { issues, id, forkOf };
    }

    function refresh() {
      const { issues, id } = currentIssues();
      for (const [key, slot] of Object.entries(errors)) slot.textContent = issues.filter((issue) => issue.field === key).map((issue) => issue.text).join('；');
      idLine.replaceChildren('将发布为 ', h('code', {}, login ? id : `<你的用户名>/${meta.slug}`), '，源码放在 ', h('code', {}, `${login ?? '<你的用户名>'}/${sourceRepoName(meta.slug)}`));
      const reasons = [
        ...sourceProblems,
        ...issues.filter((issue) => !errors[issue.field]).map((issue) => issue.text),
        ...(signInConfigured() && !login ? ['先用 GitHub 登录'] : []),
        ...(signInConfigured() ? [] : ['GitHub 登录还在配置中']),
      ];
      const blocked = reasons.length > 0 || issues.length > 0;
      publishButton.disabled = blocked;
      blockers.replaceChildren(...(reasons.length > 0 ? [h('ul', {}, reasons.map((reason) => h('li', {}, reason)))] : []));
    }

    publishButton.addEventListener('click', async () => {
      const { forkOf } = currentIssues();
      const progress = progressList();
      progressSlot.replaceChildren(progress.element);
      publishButton.disabled = true;
      publishButton.textContent = '发布中…';
      try {
        const result = await publishNewExtension({
          token: getToken(),
          files: upload.files,
          meta: { ...meta, name: meta.name.trim(), description: meta.description.trim(), version: meta.version.trim() },
          forkOf,
          registry: registryRepo(),
          extensions,
          onStep: progress.onStep,
        });
        progress.done();
        progressSlot.append(resultCard(result));
        publishButton.replaceChildren(icon('check', 18), '已发布');
      } catch (error) {
        progress.fail();
        progressSlot.append(h('div', { class: 'callout danger' }, icon('alert', 18), h('span', {}, error.message)));
        publishButton.disabled = false;
        publishButton.replaceChildren(icon('send', 18), '重试');
      }
    });

    const fileList = upload.files.slice(0, 12).map((file) => h('li', {}, h('code', {}, file.path), h('span', { class: 'fine' }, formatBytes(file.bytes.length))));
    stage.replaceChildren(
      h('div', { class: 'review' },
        h('div', { class: 'panel review-files' },
          h('div', { class: 'review-head' },
            h('h2', {}, upload.rootName ?? '你的扩展'),
            h('button', { type: 'button', class: 'link-button', onClick: () => { upload = null; zone.classList.remove('compact'); stage.replaceChildren(); } }, '换一个'),
          ),
          h('p', { class: 'fine' }, `${inspected.fileCount} 个文件 · ${formatBytes(inspected.totalBytes)}${upload.skipped.length ? ` · 已忽略 ${upload.skipped.length} 个（.git / node_modules 等）` : ''}`),
          h('ul', { class: 'file-list' }, fileList, upload.files.length > 12 ? h('li', { class: 'fine' }, `…还有 ${upload.files.length - 12} 个`) : null),
          sourceProblems.length === 0
            ? h('div', { class: 'callout ok' }, icon('check', 18), h('span', {}, '源码检查通过：有 index.ts，无依赖、无安装脚本、无符号链接'))
            : h('div', { class: 'callout danger' }, icon('alert', 18), h('div', {}, h('strong', {}, '这些问题要先改好'), h('ul', {}, sourceProblems.map((text) => h('li', {}, text))))),
        ),
        h('div', { class: 'panel review-meta' },
          h('h2', {}, '确认一下'),
          h('p', { class: 'fine' }, '已从 package.json 读出这些信息，通常不用改。'),
          h('div', { class: 'form-grid two' },
            field('名称', input('name'), 'name'),
            field('版本', input('version', { class: 'mono' }), 'version'),
            field('标识', input('slug', { class: 'mono', spellcheck: 'false' }), 'slug', '小写字母、数字、-'),
            field('许可证', license, 'license', 'SPDX 标识'),
            field('简介', description, 'description', null, true),
            h('details', { class: 'wide fork-toggle' },
              h('summary', {}, '这是改装别人的扩展吗？'),
              field('改装自', forkSelect, 'forkOf'),
            ),
          ),
          idLine,
          h('div', { class: 'publish-row' }, publishButton, blockers),
          progressSlot,
          h('datalist', { id: 'upload-licenses' }, LICENSES.map((value) => h('option', { value }))),
        ),
      ),
    );
    refresh();
  }

  return h('div', { class: 'upload' },
    h('header', { class: 'page-head' },
      h('p', { class: 'eyebrow' }, '发布扩展'),
      h('h1', {}, '拖进来，一键发布'),
      h('p', { class: 'hero-lead' }, '登录 GitHub，把扩展文件夹拖进来。页面会在你的账号下建一个仓库放源码，然后替你向扩展仓库开 PR。不用装 git，也不用填表。'),
    ),
    bar,
    zone,
    stage,
    h('p', { class: 'fine alt-route' }, '源码已经在 GitHub 上、要发到组织名下，或者不想授权？用 ', h('a', { href: '#/submit/manual' }, '手动填写'), '。'),
    h('p', { class: 'fine alt-route' }, '还没写扩展，或者要把 Pi 终端（TUI）扩展改造成 piwin 可用？看 ',
      h('a', { href: 'https://docs.piwinwin.com/docs/extension-development', target: '_blank', rel: 'noopener noreferrer' }, 'Pi 扩展开发与 piwin 适配指南'), '。'),
  );
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
