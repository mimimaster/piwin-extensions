// Home: hero search, stats, how it works, extension cards.
import { h } from './dom.js';
import { latestInstallable, searchEntries } from './search.js';
import { avatar, chip, icon } from './ui.js';

export function listView(extensions, query, onQuery) {
  const results = h('div', { class: 'results' });
  const count = h('p', { class: 'results-count', 'aria-live': 'polite' });
  const renderResults = (value) => {
    const found = searchEntries(extensions, value);
    count.textContent = value.trim() ? `找到 ${found.length} 个扩展` : `全部扩展 · ${found.length}`;
    results.replaceChildren(
      ...(found.length > 0 ? found.map(card) : [emptyState(extensions.length === 0, value)]),
    );
  };
  const input = h('input', {
    type: 'search',
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

  const authors = new Set(extensions.flatMap((entry) => entry.owners));
  const forks = extensions.filter((entry) => entry.forkOf).length;
  return h(
    'div',
    { class: 'home' },
    h('section', { class: 'hero' },
      h('p', { class: 'eyebrow' }, 'piwin · 社区扩展'),
      h('h1', {}, '给 piwin 添一支笔'),
      h('p', { class: 'hero-lead' },
        'piwin 扩展站。对于部分支持或者无法支持的扩展，你可以进行改造，基本上是做桌面 UI 功能适配，独立成仓库，提交 PR 至 piwin-extensions 仓库，或者直接在这里上传，GitHub 登录可选择仓库直接申请合并。'),
      h('label', { class: 'search-box' }, icon('search', 18), input),
      h('div', { class: 'stats' },
        stat(extensions.length, '个扩展'),
        stat(authors.size, '位作者'),
        stat(forks, '个改装版'),
      ),
    ),
    h('section', { class: 'catalog' }, count, results),
    howItWorks(),
  );
}

function stat(value, label) {
  return h('div', { class: 'stat' }, h('strong', {}, String(value)), h('span', {}, label));
}

function card(entry) {
  const latest = latestInstallable(entry);
  // The namespace (user or org) is who publishes; owners are maintainers.
  const namespace = entry.id.split('/')[0];
  return h(
    'a',
    { class: 'card', href: `#/ext/${entry.id}` },
    h('div', { class: 'card-top' },
      h('span', { class: 'card-owner' }, avatar(namespace, 20), namespace),
      entry.forkOf ? chip('改装', { tone: 'amber', iconName: 'fork' }) : null,
    ),
    h('h3', {}, entry.name),
    h('p', { class: 'card-desc' }, entry.description || '作者没有写简介。'),
    h('div', { class: 'card-foot' },
      chip(`v${latest.version}`, { iconName: 'tag' }),
      chip(entry.license, { iconName: 'scale' }),
      ...(entry.keywords ?? []).slice(0, 2).map((keyword) => chip(`#${keyword}`, { tone: 'ghost' })),
      h('span', { class: 'card-go' }, icon('arrowRight', 16)),
    ),
  );
}

function emptyState(registryEmpty, query) {
  if (!registryEmpty) {
    return h('div', { class: 'empty' },
      h('p', {}, `没有找到和 “${query.trim()}” 相关的扩展。`),
      h('a', { href: '#/submit', class: 'button secondary' }, '提交一个？'),
    );
  }
  return h('div', { class: 'empty empty-first' },
    h('div', { class: 'seal seal-lg', 'aria-hidden': 'true' }, '砚'),
    h('h3', {}, '砚台已备，还没有第一支笔'),
    h('p', {}, '仓库刚刚开张。把你写的 Pi 扩展提交上来，它会成为这里的第一个条目。'),
    h('a', { href: '#/submit', class: 'button' }, icon('send', 16), '发布第一个扩展'),
  );
}

function howItWorks() {
  const steps = [
    ['code', '写一个 piwin 扩展', '可以是为 Pi 扩展做 UI 适配，也可以是自研 piwin 扩展。'],
    ['send', '登录 GitHub 后选择项目或者选择拖一个扩展文件夹进来', '页面替你建仓库、开 PR，CI 自动检查。'],
    ['download', '在 piwin 里安装', 'PR 合并后，可直接在 piwin 扩展市场中检索到。'],
  ];
  return h('section', { class: 'how' },
    h('h2', {}, '三步上架'),
    h('ol', { class: 'steps' },
      steps.map(([iconName, title, text], index) =>
        h('li', { class: 'step' },
          h('span', { class: 'step-index' }, String(index + 1)),
          h('span', { class: 'step-icon' }, icon(iconName, 20)),
          h('h3', {}, title),
          h('p', {}, text),
        ),
      ),
    ),
  );
}
