// Submit form. Paste a repository and most fields fill themselves; every
// field shows the CI rule it breaks as you go; the source is checked in the
// browser with the CI's own rules before any PR exists.
import { BRANCH, registryRepo } from './config.js';
import { copyButton, copyText, externalLink, h } from './dom.js';
import { clearDraft, loadDraft, saveDraft } from './draft-store.js';
import { buildSubmission, newFileLinks } from './entry-builder.js';
import { fetchHeadCommit, fetchRepository, parseRepositoryInput } from './github-api.js';
import { describeProblem } from './problem-text.js';
import { latestInstallable } from './search.js';
import { inspectSource } from './source-inspect.js';
import { lookupRepository, toSlug, toTitle } from './submit-autofill.js';
import { avatar, icon } from './ui.js';
import { resultBlock } from './view-result.js';

const LICENSES = ['MIT', 'Apache-2.0', 'BSD-3-Clause', 'ISC', 'MPL-2.0', 'GPL-3.0-only', 'LGPL-3.0-only', 'AGPL-3.0-only', 'Unlicense'];
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;

export function submitView(extensions) {
  const repo = registryRepo();
  const input = (placeholder, attributes = {}) => h('input', { placeholder, ...attributes });
  const controls = {
    owner: input('你的 GitHub 用户名或组织', { autocomplete: 'username', spellcheck: 'false' }),
    extraOwners: input('可选，逗号分隔', { spellcheck: 'false' }),
    repository: input('https://github.com/<owner>/<repo>', { class: 'mono', spellcheck: 'false' }),
    subdir: input('留空表示仓库根目录', { class: 'mono', spellcheck: 'false' }),
    commit: input('完整 40 位 commit SHA', { class: 'mono', spellcheck: 'false' }),
    version: input('1.0.0', { class: 'mono', spellcheck: 'false' }),
    license: input('MIT', { list: 'licenses', spellcheck: 'false' }),
    stampDate: h('input', { type: 'checkbox', checked: true }),
    slug: input('git-autopilot', { class: 'mono', spellcheck: 'false' }),
    name: input('Git Autopilot'),
    description: h('textarea', { rows: 3, placeholder: '一句话说明它能帮用户做什么' }),
    keywords: input('可选，逗号分隔'),
    homepage: input('可选，https://…', { spellcheck: 'false' }),
    forkId: h('select', {}, h('option', { value: '' }, '不是改装版'),
      extensions.map((entry) => h('option', { value: entry.id }, `${entry.id}（${entry.name}）`))),
    forkVersion: h('select', { disabled: true }, h('option', { value: '' }, '先选原扩展')),
  };
  const errors = {};
  const touched = new Set();
  const edited = new Set();
  let submitAttempted = false;
  let source = { status: 'idle', problems: [], key: '' };
  let latestResult = null;

  // ── values ───────────────────────────────────────────
  const values = () =>
    Object.fromEntries(Object.entries(controls).map(([key, control]) => [key, control.type === 'checkbox' ? control.checked : control.value]));

  function setValue(key, value, { force = false } = {}) {
    const control = controls[key];
    if (!control || value === undefined || (!force && edited.has(key) && control.value)) return;
    if (control.type === 'checkbox') control.checked = Boolean(value);
    else control.value = value;
    if (key === 'forkId') syncForkVersions(value ? undefined : '');
  }

  function syncForkVersions(preferred) {
    const base = extensions.find((entry) => entry.id === controls.forkId.value);
    controls.forkVersion.replaceChildren(
      ...(base
        ? base.versions.map((version) => h('option', { value: version.version }, version.yanked ? `${version.version}（已撤回）` : version.version))
        : [h('option', { value: '' }, '先选原扩展')]),
    );
    controls.forkVersion.disabled = !base;
    if (base) controls.forkVersion.value = preferred || latestInstallable(base)?.version || base.versions[0].version;
  }
  controls.forkId.addEventListener('change', () => {
    syncForkVersions();
    refresh();
  });

  // ── repository lookup ────────────────────────────────
  const lookupInput = input('粘贴仓库地址，例如 https://github.com/you/your-extension', { class: 'lookup-input', spellcheck: 'false' });
  const lookupButton = h('button', { type: 'button', class: 'button' }, icon('github', 16), '读取仓库');
  const lookupStatus = h('div', { class: 'lookup-status', 'aria-live': 'polite' });
  const rootChips = h('div', { class: 'root-chips' });

  async function runLookup() {
    const value = lookupInput.value.trim();
    if (!value) return;
    lookupButton.disabled = true;
    lookupStatus.replaceChildren(h('p', { class: 'fine' }, h('span', { class: 'spinner' }), '正在读取仓库、最新 commit 和源码结构…'));
    try {
      const found = await lookupRepository(value, extensions);
      for (const [key, suggestion] of Object.entries(found.suggestions)) {
        if (key === 'forkVersion') continue;
        setValue(key, suggestion, { force: ['repository', 'commit', 'subdir'].includes(key) });
      }
      if (found.suggestions.forkId) syncForkVersions(found.suggestions.forkVersion);
      renderRootChips(found.roots);
      applySource(found.source, sourceKey());
      lookupStatus.replaceChildren(lookupSummary(found));
      refresh();
    } catch (error) {
      lookupStatus.replaceChildren(h('div', { class: 'callout danger' }, icon('alert', 18), h('span', {}, error.message)));
    } finally {
      lookupButton.disabled = false;
    }
  }
  lookupButton.addEventListener('click', runLookup);
  lookupInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      runLookup();
    }
  });

  function lookupSummary(found) {
    const notes = [];
    if (found.repo.archived) notes.push(h('li', {}, '这个仓库已归档（archived），用户可能拿不到更新。'));
    if (found.forkBase) {
      notes.push(h('li', {}, '这是 ', h('a', { href: `#/ext/${found.forkBase.id}` }, found.forkBase.id), ' 的 fork，已填好「改装自」。'));
    }
    if (found.roots.length > 1) notes.push(h('li', {}, `找到 ${found.roots.length} 个含 index.ts 的目录，请在「扩展路径」下选一个。`));
    if (found.roots.length === 0) notes.push(h('li', {}, '没找到 index.ts。单文件扩展请在「扩展路径」填 .ts 文件路径。'));
    if (!found.suggestions.version) notes.push(h('li', {}, 'package.json 里没有版本号，请手动填写。'));
    if (!found.suggestions.license) notes.push(h('li', {}, '仓库没有声明许可证，请手动填写 SPDX 标识。'));
    return h('div', { class: 'lookup-card' },
      h('div', { class: 'lookup-head' },
        avatar(found.repo.owner, 36),
        h('div', {},
          h('strong', {}, found.repo.fullName),
          h('p', { class: 'fine' }, `默认分支 ${found.repo.defaultBranch} · 最新 commit ${found.commit.slice(0, 12)}`),
        ),
        h('span', { class: 'chip accent' }, icon('check', 12), '已填入'),
      ),
      found.alreadyListed
        ? h('div', { class: 'callout warn' }, icon('alert', 18),
            h('span', {}, '这个仓库已经收录为 ', h('a', { href: `#/ext/${found.alreadyListed.id}` }, found.alreadyListed.id), '。要发新版本请去它的详情页。'))
        : null,
      notes.length > 0 ? h('ul', { class: 'lookup-notes' }, notes) : null,
    );
  }

  const MAX_ROOT_CHIPS = 8;
  function renderRootChips(roots) {
    const shown = roots.length > 1 ? roots.slice(0, MAX_ROOT_CHIPS) : [];
    rootChips.replaceChildren(
      ...shown.map((root) =>
        h('button', {
          type: 'button',
          class: `root-chip${controls.subdir.value === root ? ' is-active' : ''}`,
          onClick: () => {
            setValue('subdir', root, { force: true });
            followSubdir();
            renderRootChips(roots);
            refresh();
          },
        }, root || '（根目录）'),
      ),
      roots.length > shown.length && shown.length > 0
        ? h('span', { class: 'fine' }, `还有 ${roots.length - shown.length} 个目录，没列出的可以直接输入路径。`)
        : null,
    );
  }

  /** Until the user types their own, name the extension after its path. */
  function followSubdir() {
    const leaf = controls.subdir.value.trim().replace(/\/+$/, '').split('/').pop();
    if (!leaf) return;
    if (!edited.has('slug')) controls.slug.value = toSlug(leaf);
    if (!edited.has('name')) controls.name.value = toTitle(leaf);
  }

  // ── latest commit button ─────────────────────────────
  const latestButton = h('button', { type: 'button', class: 'inline-action', title: '填入默认分支的最新 commit' }, '用最新');
  latestButton.addEventListener('click', async () => {
    const parsed = parseRepositoryInput(controls.repository.value);
    if (!parsed) {
      touched.add('repository');
      refresh();
      controls.repository.focus();
      return;
    }
    latestButton.disabled = true;
    latestButton.textContent = '读取中…';
    try {
      const info = await fetchRepository(parsed.owner, parsed.repo);
      setValue('commit', await fetchHeadCommit(parsed.owner, parsed.repo, info.defaultBranch), { force: true });
      refresh();
    } catch (error) {
      errors.commit.textContent = error.message;
    } finally {
      latestButton.disabled = false;
      latestButton.textContent = '用最新';
    }
  });

  // ── source check ─────────────────────────────────────
  const sourceKey = () => [controls.repository.value.trim(), controls.commit.value.trim().toLowerCase(), controls.subdir.value.trim()].join('|');
  let sourceTimer;
  function scheduleSourceCheck() {
    const key = sourceKey();
    const [repository, commit, subdir] = key.split('|');
    if (!parseRepositoryInput(repository) || !COMMIT_PATTERN.test(commit)) {
      clearTimeout(sourceTimer);
      if (source.status !== 'idle') applySource(null, '');
      return;
    }
    // Same target already checked or in flight: other fields changed, keep it.
    if (key === source.key && source.status !== 'error') return;
    clearTimeout(sourceTimer);
    source = { ...source, status: 'checking', key };
    renderChecklist();
    sourceTimer = setTimeout(async () => {
      try {
        const result = await inspectSource({ repository, commit, subdir });
        if (sourceKey() === key) {
          applySource(result, key);
          if (!edited.has('version') && !controls.version.value && result.packageVersion) setValue('version', result.packageVersion);
          refresh({ skipSource: true });
        }
      } catch (error) {
        if (sourceKey() === key) {
          source = { status: 'error', problems: [], key, message: error.message };
          renderChecklist();
        }
      }
    }, 600);
  }

  function applySource(result, key) {
    source = result
      ? { status: result.problems.length > 0 ? 'problems' : 'ok', problems: result.problems, truncated: result.truncated, kind: result.kind, key }
      : { status: 'idle', problems: [], key: '' };
    renderChecklist();
  }

  // ── checklist + preview ──────────────────────────────
  const checklist = h('ul', { class: 'checklist' });
  const previewPath = h('code', {}, '');
  const previewJson = h('pre', { class: 'json live' }, '');

  function checkItem(state, title, detail, onClick) {
    const iconName = state === 'ok' ? 'check' : state === 'bad' ? 'alert' : state === 'busy' ? null : 'pin';
    const body = [h('strong', {}, title), detail ? h('span', { class: 'fine' }, detail) : null];
    return h('li', { class: `check-item is-${state}` },
      state === 'busy' ? h('span', { class: 'spinner' }) : icon(iconName, 16),
      onClick ? h('button', { type: 'button', class: 'check-jump', onClick }, body) : h('div', {}, body),
    );
  }

  function renderChecklist() {
    const fieldIssues = latestResult ? latestResult.issues.filter((issue) => issue.field !== 'slug' || !issue.text.includes('已经存在')) : [];
    const exists = latestResult?.issues.find((issue) => issue.text.includes('已经存在'));
    const sourceItem = {
      idle: () => checkItem('todo', '源码检查', '填好仓库和 commit 后自动检查'),
      checking: () => checkItem('busy', '源码检查中…', '读取 GitHub 上这个 commit 的文件列表'),
      ok: () =>
        checkItem('ok', '源码结构通过', source.truncated
          ? '仓库太大，浏览器只做了部分检查，CI 会完整检查'
          : source.kind === 'file'
            ? '单文件 .ts 扩展，大小在限制内'
            : '有 index.ts，无依赖、无安装脚本、无符号链接'),
      problems: () => checkItem('bad', `源码有 ${source.problems.length} 个问题`, source.problems.map((problem) => describeProblem(problem).text).join('；')),
      error: () => checkItem('todo', '暂时无法检查源码', source.message),
    }[source.status]();
    checklist.replaceChildren(
      fieldIssues.length === 0
        ? checkItem('ok', '条目字段合规', '与 CI 同一套规则')
        : checkItem('bad', `还有 ${fieldIssues.length} 处要改`, '点这里跳到第一处', () => focusFirstIssue(fieldIssues)),
      sourceItem,
      exists
        ? checkItem('bad', '扩展标识已被占用', exists.text)
        : checkItem(latestResult && controls.slug.value ? 'ok' : 'todo', '扩展标识可用', latestResult ? `id：${latestResult.id}` : ''),
    );
  }

  function focusFirstIssue(issues) {
    for (const issue of issues) touched.add(issue.field);
    showErrors();
    const target = controls[issues[0].field] ?? controls.owner;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.focus({ preventScroll: true });
  }

  // ── errors under fields ──────────────────────────────
  function showErrors() {
    const byField = {};
    for (const issue of latestResult?.issues ?? []) (byField[issue.field] ??= []).push(issue.text);
    for (const problem of source.status === 'problems' ? source.problems : []) {
      const described = describeProblem(problem);
      const field = described.field === 'source' ? 'subdir' : described.field;
      (byField[field] ??= []).push(described.text);
    }
    for (const [field, slot] of Object.entries(errors)) {
      const messages = byField[field] ?? [];
      const visible = messages.length > 0 && (submitAttempted || touched.has(field) || (field === 'subdir' && source.status === 'problems'));
      slot.textContent = visible ? messages.join('；') : '';
      slot.closest('.field')?.classList.toggle('has-error', visible);
    }
  }

  let draftTimer;
  function refresh({ skipSource = false } = {}) {
    latestResult = buildSubmission(values(), extensions);
    previewPath.textContent = `extensions/${latestResult.owner || '<owner>'}/${latestResult.name || '<name>'}.json`;
    previewJson.textContent = latestResult.text;
    showErrors();
    renderChecklist();
    if (!skipSource) scheduleSourceCheck();
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => saveDraft({ ...values(), lookup: lookupInput.value }), 300);
  }

  // ── generate ─────────────────────────────────────────
  const output = h('div', { class: 'output' });
  const submit = (event) => {
    event.preventDefault();
    submitAttempted = true;
    refresh({ skipSource: true });
    const result = latestResult;
    if (result.issues.length > 0) {
      output.replaceChildren();
      focusFirstIssue(result.issues);
      return;
    }
    if (source.status === 'problems') {
      output.replaceChildren(...resultBlock(source.problems.map((problem) => describeProblem(problem).text), '', [], ''));
      output.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const links = newFileLinks(repo, result.owner, result.name, result.text);
    const actions = links.prefilledUrl
      ? [externalLink(links.prefilledUrl, [icon('github', 16), ' 在 GitHub 上创建 PR'], 'button'), copyButton('复制 JSON', result.text)]
      : [h('button', {
          type: 'button',
          class: 'button',
          onClick: async () => {
            await copyText(result.text);
            window.open(links.emptyUrl, '_blank', 'noopener');
          },
        }, icon('github', 16), ' 复制 JSON 并打开 GitHub')];
    const unchecked = source.status === 'ok' ? '' : ' 源码还没在浏览器里检查过，CI 会在 PR 上检查。';
    const note = (links.prefilledUrl
      ? `会打开 GitHub 的新建文件页，extensions/${result.owner}/${result.name}.json 已预填。没有写权限时 GitHub 会自动 fork 并替你开 PR，PR 作者就是你。`
      : `条目太长（${links.length} 字符）放不进链接：点按钮会复制 JSON 并打开空白新建页，粘贴后提交 PR。`) + unchecked;
    output.replaceChildren(...resultBlock([], result.text, actions, note));
    if (links.prefilledUrl) output.dataset.prefilledUrl = links.prefilledUrl;
    output.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  // ── layout ───────────────────────────────────────────
  const field = (key, label, hint, options = {}) => {
    errors[key] = h('small', { class: 'field-error', role: 'alert' });
    return h('label', { class: `field${options.wide ? ' wide' : ''}` },
      h('span', { class: 'field-label' }, label, options.action ?? null),
      controls[key],
      options.after ?? null,
      hint ? h('small', { class: 'field-hint' }, hint) : null,
      errors[key],
    );
  };
  const group = (index, title, hint, ...children) =>
    h('fieldset', { class: 'group' },
      h('legend', {}, h('span', { class: 'step-index' }, String(index)), title),
      hint ? h('p', { class: 'fine' }, hint) : null,
      h('div', { class: 'form-grid two' }, children),
    );

  const draftBanner = h('div', { class: 'draft-banner', hidden: true });
  const form = h('form', { class: 'submit-form', novalidate: true, onSubmit: submit },
    group(1, '源码与版本', 'piwin 只拉取这个 commit，不跑 npm，也不跑任何脚本。',
      field('repository', '源码仓库', null, { wide: true }),
      field('subdir', '扩展路径', '含 index.ts 的目录，或单个 .ts 文件', { after: rootChips }),
      field('license', '许可证', 'SPDX 标识'),
      field('commit', 'commit', '需已推送到公开仓库', { action: latestButton }),
      field('version', '版本号', '通常取 package.json 的 version'),
      h('label', { class: 'check wide' }, controls.stampDate, '写入发布时间'),
    ),
    group(2, '谁来维护', '条目放在这个 GitHub 用户名或组织下；提 PR 的账号必须是维护者。',
      field('owner', '发布到', '用户名，或你公开所属的组织'),
      field('extraOwners', '其他维护者'),
    ),
    group(3, '扩展信息', '市场卡片和搜索用到的内容。',
      field('slug', '扩展标识', 'id 为 发布到/扩展标识'),
      field('name', '显示名称'),
      field('description', '简介', null, { wide: true }),
      field('keywords', '关键词'),
      field('homepage', '主页'),
    ),
    group(4, '改装（可选）', '改的是别人的扩展？选原扩展和基于的版本；copyleft 许可证要沿用原许可证。',
      field('forkId', '改装自'),
      field('forkVersion', '基于的版本'),
    ),
    h('div', { class: 'submit-bar' },
      h('button', { type: 'submit', class: 'button' }, icon('send', 16), '生成 PR 链接'),
      h('button', { type: 'button', class: 'button secondary', onClick: resetForm }, '清空'),
      h('span', { class: 'fine' }, '只在你的浏览器里检查，除了读取 GitHub 公开信息不会上传任何东西。'),
    ),
    h('datalist', { id: 'licenses' }, LICENSES.map((license) => h('option', { value: license }))),
  );

  form.addEventListener('input', (event) => {
    const key = Object.entries(controls).find(([, control]) => control === event.target)?.[0];
    if (key && event.isTrusted) edited.add(key);
    if (key === 'subdir') followSubdir();
    refresh();
  });
  form.addEventListener('focusout', (event) => {
    const key = Object.entries(controls).find(([, control]) => control === event.target)?.[0];
    if (key) {
      touched.add(key);
      showErrors();
    }
  });
  controls.owner.addEventListener('blur', () => {
    controls.owner.value = controls.owner.value.trim().toLowerCase();
    refresh();
  });
  controls.commit.addEventListener('blur', () => {
    controls.commit.value = controls.commit.value.trim().toLowerCase();
    refresh();
  });

  function resetForm() {
    clearDraft();
    window.location.reload();
  }

  // Restore an unsent draft.
  const draft = loadDraft();
  if (draft) {
    for (const key of Object.keys(controls)) {
      if (draft[key] === undefined || key === 'forkVersion') continue;
      setValue(key, draft[key], { force: true });
      // What the user typed last time wins over a later repository lookup.
      if (draft[key] !== '' && draft[key] !== true) edited.add(key);
    }
    if (draft.forkId) syncForkVersions(draft.forkVersion);
    lookupInput.value = draft.lookup ?? '';
    draftBanner.hidden = false;
    draftBanner.replaceChildren(icon('pin', 14), '已恢复上次没提交的草稿。',
      h('button', { type: 'button', class: 'link-button', onClick: resetForm }, '清空重来'));
  }

  refresh();
  return h('div', { class: 'submit' },
    h('header', { class: 'page-head' },
      h('p', { class: 'eyebrow' }, '提交扩展'),
      h('h1', {}, '把你的扩展放进仓库'),
      h('p', { class: 'hero-lead' },
        '这里只生成一个条目文件，代码留在你自己的仓库。完整规则见 ',
        externalLink(`https://github.com/${repo}/blob/${BRANCH}/CONTRIBUTING.md`, 'CONTRIBUTING'), '。'),
    ),
    draftBanner,
    h('section', { class: 'lookup' },
      h('div', { class: 'lookup-copy' },
        h('h2', {}, '从仓库开始'),
        h('p', { class: 'fine' }, '贴上 GitHub 仓库地址，自动填好作者、名称、简介、许可证、最新 commit、版本号和扩展路径，并先检查一遍源码。'),
      ),
      h('div', { class: 'lookup-row' }, lookupInput, lookupButton),
      lookupStatus,
    ),
    h('div', { class: 'submit-grid' },
      h('div', {}, form, output),
      h('aside', { class: 'preview' },
        h('div', { class: 'panel' }, h('h2', {}, '提交前检查'), checklist),
        h('div', { class: 'panel' },
          h('h2', {}, '条目预览'),
          h('p', { class: 'fine' }, previewPath),
          previewJson,
        ),
      ),
    ),
  );
}
