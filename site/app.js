// Hash router: #/  ·  #/ext/<owner>/<name>  ·  #/submit
import { registryRepo } from './config.js';
import { externalLink, h } from './dom.js';
import { detailView, listView, submitView } from './views.js';

const main = document.querySelector('main');
let extensions = [];
let query = '';

async function loadIndex() {
  const response = await fetch('./index.json', { cache: 'no-cache' });
  if (!response.ok) throw new Error(`index.json: HTTP ${response.status}`);
  const index = await response.json();
  if (index.schemaVersion !== 1 || !Array.isArray(index.extensions)) {
    throw new Error('index.json has an unsupported format');
  }
  return index.extensions;
}

function render() {
  const route = window.location.hash.replace(/^#\/?/, '');
  let view;
  if (route.startsWith('ext/')) {
    const id = decodeURIComponent(route.slice('ext/'.length));
    const entry = extensions.find((item) => item.id === id);
    document.title = entry ? `${entry.name} · piwin 扩展仓库` : 'piwin 扩展仓库';
    view = detailView(entry, extensions);
  } else if (route === 'submit') {
    document.title = '提交扩展 · piwin 扩展仓库';
    view = submitView(extensions);
  } else {
    document.title = 'piwin 扩展仓库';
    view = listView(extensions, query, (value) => {
      query = value;
    });
  }
  main.replaceChildren(view);
  for (const link of document.querySelectorAll('[data-nav]')) {
    link.toggleAttribute('aria-current', link.getAttribute('href') === `#/${route.split('/')[0]}`);
  }
  window.scrollTo(0, 0);
}

function renderChrome() {
  const repo = registryRepo();
  document.querySelector('[data-repo-link]').replaceWith(
    externalLink(`https://github.com/${repo}`, 'GitHub 仓库'),
  );
}

renderChrome();
try {
  extensions = await loadIndex();
  window.addEventListener('hashchange', render);
  render();
} catch (error) {
  main.replaceChildren(
    h('section', {}, h('h1', {}, '索引加载失败'), h('p', { class: 'problems' }, String(error.message ?? error))),
  );
}
