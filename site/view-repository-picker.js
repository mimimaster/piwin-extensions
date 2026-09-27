// Existing GitHub repository → checked commit → registry pull request.
import { getToken } from './auth.js';
import { registryRepo } from './config.js';
import { h } from './dom.js';
import { buildSubmission } from './entry-builder.js';
import { createGitHubWriter } from './github-write.js';
import { describeProblem } from './problem-text.js';
import { publishExistingExtension } from './publish-flow.js';
import { latestInstallable } from './search.js';
import { lookupRepository } from './submit-autofill.js';
import { inspectSource } from './source-inspect.js';
import { icon } from './ui.js';
import { progressList, resultCard } from './view-publish-parts.js';

export function repositoryPicker(extensions) {
  let login;
  let page = 1;
  let repositories = [];
  let selected = null;
  let source = null;
  let checking = false;
  let publishing = false;
  let generation = 0;
  let selectionRequest = 0;
  const search = h('input', { type: 'search', placeholder: '搜索你的公开仓库', 'aria-label': '搜索仓库' });
  const list = h('div', { class: 'repository-list' });
  const more = h('button', { type: 'button', class: 'button secondary' }, '加载更多');
  const status = h('div');
  const review = h('div', { class: 'repository-review' });
  const fields = Object.fromEntries(['slug', 'name', 'version', 'license', 'description', 'keywords', 'homepage', 'subdir']
    .map((key) => [key, key === 'description' ? h('textarea', { rows: 2 }) : h('input', { spellcheck: 'false' })]));
  const fork = h('select', {}, h('option', { value: '' }, '不是改装版'),
    extensions.map((entry) => h('option', { value: entry.id }, `${entry.id}（${entry.name}）`)));
  const roots = h('div', { class: 'repository-roots' });
  const summary = h('p', { class: 'fine' });
  const problems = h('div', { class: 'blockers' });
  const publish = h('button', { type: 'button', class: 'button big' }, icon('send', 18), '发布到扩展市场');
  const progressSlot = h('div');

  function values() {
    const form = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value.trim()]));
    return {
      ...form, owner: login ?? '', extraOwners: '', repository: selected?.suggestions.repository ?? '',
      commit: selected?.commit ?? '', forkId: fork.value,
      forkVersion: fork.value
        ? latestInstallable(extensions.find((entry) => entry.id === fork.value))?.version ?? ''
        : '',
      stampDate: true,
    };
  }

  function refresh() {
    if (!selected) return;
    const result = buildSubmission(values(), extensions);
    const reasons = [
      ...result.problems,
      ...(checking ? ['正在检查扩展源码'] : source ? source.problems.map((problem) => describeProblem(problem).text) : ['请检查扩展源码']),
      ...(source?.truncated ? ['仓库文件列表过大，无法完整检查；请用手动填写'] : []),
    ];
    summary.replaceChildren('条目：', h('code', {}, result.id), ' · 固定 commit：', h('code', {}, selected.commit.slice(0, 12)));
    problems.replaceChildren(reasons.length ? h('ul', {}, reasons.map((reason) => h('li', {}, reason))) :
      h('div', { class: 'callout ok' }, icon('check', 18), '条目和源码检查通过'));
    publish.disabled = publishing || reasons.length > 0;
  }

  async function checkPath() {
    if (!selected) return;
    const current = ++generation;
    checking = true;
    source = null;
    refresh();
    try {
      const checked = await inspectSource({
        repository: selected.suggestions.repository, commit: selected.commit, subdir: fields.subdir.value.trim(),
      });
      if (current === generation) source = checked;
    } catch (error) {
      if (current === generation) source = { problems: [error.message] };
    } finally {
      if (current === generation) {
        checking = false;
        refresh();
      }
    }
  }

  function renderSelection(result) {
    selected = result;
    source = null;
    for (const [key, field] of Object.entries(fields)) field.value = result.suggestions[key] ?? '';
    fork.value = result.forkBase?.id ?? '';
    roots.replaceChildren();
    if (result.roots.length) {
      const choice = h('select', { 'aria-label': '扩展目录' },
        result.roots.map((root) => h('option', { value: root }, root || '仓库根目录')));
      if (!result.roots.includes(fields.subdir.value)) fields.subdir.value = result.roots[0];
      choice.value = fields.subdir.value;
      choice.addEventListener('change', () => { fields.subdir.value = choice.value; checkPath(); });
      roots.replaceChildren(h('span', { class: 'fine' }, '检测到的扩展目录：'), choice);
    }
    const field = (label, key, hint) => h('label', { class: `field${key === 'description' ? ' wide' : ''}` },
      h('span', { class: 'field-label' }, label), fields[key],
      hint ? h('small', { class: 'field-hint' }, hint) : null);
    review.replaceChildren(h('div', { class: 'panel review-meta' },
      h('h2', {}, result.repo.fullName),
      h('p', { class: 'fine' }, '源码保留在原仓库；发布只向扩展市场提交一个固定到当前 commit 的条目。'),
      roots,
      h('div', { class: 'form-grid two' },
        field('扩展路径', 'subdir', '根目录留空；单文件扩展可填 .ts 路径'),
        field('扩展标识', 'slug'), field('名称', 'name'), field('版本', 'version'),
        field('许可证', 'license'), field('关键词', 'keywords', '用逗号分隔'),
        field('主页', 'homepage'), field('简介', 'description'),
        h('label', { class: 'field wide' }, h('span', { class: 'field-label' }, '改装自'), fork)),
      summary, problems, h('div', { class: 'publish-row' }, publish), progressSlot));
    status.replaceChildren(result.alreadyListed
      ? h('div', { class: 'callout warn' }, `这个仓库已有扩展 ${result.alreadyListed.id}；发新版本请到详情页。`) : '');
    checkPath();
  }

  async function choose(repo) {
    const request = ++selectionRequest;
    generation += 1;
    selected = null;
    review.replaceChildren();
    status.replaceChildren(h('p', { class: 'fine' }, `正在检查 ${repo.full_name}…`));
    try {
      const result = await lookupRepository(repo.html_url, extensions);
      if (request !== selectionRequest) return;
      if (result.repo.isPrivate || result.repo.archived) throw new Error('只能发布公开且未归档的仓库。');
      renderSelection(result);
    } catch (error) {
      if (request === selectionRequest) status.replaceChildren(h('div', { class: 'callout danger' }, icon('alert', 18), error.message));
    }
  }

  function renderList() {
    const query = search.value.trim().toLowerCase();
    const matches = repositories.filter((repo) => repo.full_name.toLowerCase().includes(query));
    list.replaceChildren(...matches.map((repo) => h('button', {
      type: 'button', class: 'repository-item', onClick: () => choose(repo),
    }, h('strong', {}, repo.full_name), h('span', { class: 'fine' }, repo.description ?? ''))));
    if (!matches.length) list.replaceChildren(h('p', { class: 'fine' }, '没有匹配的公开仓库。'));
  }

  async function load() {
    if (!login) return;
    const requestedLogin = login;
    more.disabled = true;
    status.replaceChildren(h('p', { class: 'fine' }, '正在读取 GitHub 仓库…'));
    try {
      const batch = await createGitHubWriter(getToken()).listRepositories(page);
      if (login !== requestedLogin) return;
      repositories.push(...batch.filter((repo) => !repo.private && !repo.archived && !repo.disabled &&
        repo.permissions?.push && repo.owner?.login?.toLowerCase() === login.toLowerCase()));
      page += 1;
      more.hidden = batch.length < 100;
      renderList();
      status.replaceChildren();
    } catch (error) {
      if (login === requestedLogin) status.replaceChildren(h('div', { class: 'callout danger' }, icon('alert', 18), error.message));
    } finally {
      more.disabled = false;
    }
  }

  publish.addEventListener('click', async () => {
    if (!selected || publish.disabled) return;
    publishing = true;
    refresh();
    const progress = progressList({ existing: true });
    progressSlot.replaceChildren(progress.element);
    const form = values();
    try {
      const result = await publishExistingExtension({
        token: getToken(), repository: form.repository, commit: form.commit, subdir: form.subdir,
        meta: { slug: form.slug, name: form.name, version: form.version, license: form.license,
          description: form.description, keywords: form.keywords.split(/[,，\s]+/).filter(Boolean), homepage: form.homepage },
        forkOf: form.forkId ? { id: form.forkId, version: form.forkVersion } : undefined,
        registry: registryRepo(), extensions, onStep: progress.onStep,
      });
      progress.done();
      progressSlot.append(resultCard(result));
      publish.replaceChildren(icon('check', 18), '已提交 PR');
    } catch (error) {
      progress.fail();
      progressSlot.append(h('div', { class: 'callout danger' }, icon('alert', 18), error.message));
      publishing = false;
      refresh();
    }
  });
  for (const [key, field] of Object.entries(fields)) {
    field.addEventListener('input', key === 'subdir' ? () => {
      clearTimeout(field.checkTimer);
      generation += 1;
      source = null;
      checking = true;
      field.checkTimer = setTimeout(checkPath, 400);
      refresh();
    } : refresh);
  }
  fork.addEventListener('change', refresh);
  search.addEventListener('input', renderList);
  more.addEventListener('click', load);

  const element = h('section', { class: 'repository-picker' },
    h('h2', {}, '选择 GitHub 上的源码'),
    h('p', { class: 'fine' }, '从你账号下的公开仓库选择扩展，检查源码后直接开市场 PR。'),
    search, list, more, status, review);
  return { element, setLogin(value) {
    if (value === login) return;
    selectionRequest += 1;
    generation += 1;
    login = value;
    page = 1;
    repositories = [];
    selected = null;
    review.replaceChildren();
    list.replaceChildren();
    search.hidden = !login;
    more.hidden = true;
    status.replaceChildren(login ? '' : h('p', { class: 'fine' }, '登录 GitHub 后可以选择你的公开仓库。'));
    if (login) load();
  } };
}
