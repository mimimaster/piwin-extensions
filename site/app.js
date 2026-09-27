// Hash router: #/  ·  #/ext/<owner>/<name>  ·  #/submit (one-click)  ·  #/submit/manual
import { completeSignIn } from './auth.js';
import { registryRepo } from './config.js';
import { externalLink, h } from './dom.js';
import { icon } from './ui.js';
import { detailView } from './view-detail.js';
import { listView } from './view-list.js';
import { submitView } from './view-submit.js';
import { uploadView } from './view-upload.js';

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
  } else if (route === 'submit/manual') {
    document.title = '手动填写 · piwin 扩展仓库';
    view = submitView(extensions);
  } else if (route === 'submit') {
    document.title = '发布扩展 · piwin 扩展仓库';
    view = uploadView(extensions);
  } else {
    document.title = 'piwin 扩展仓库';
    view = listView(extensions, query, (value) => {
      query = value;
    });
  }
  main.replaceChildren(view);
  for (const link of document.querySelectorAll('[data-nav]')) {
    const section = route.startsWith('submit') ? '#/submit' : '#/';
    link.toggleAttribute('aria-current', link.getAttribute('href') === section);
  }
  window.scrollTo(0, 0);
}

function renderChrome() {
  const repo = registryRepo();
  for (const slot of document.querySelectorAll('[data-repo-link]')) {
    slot.replaceWith(
      externalLink(`https://github.com/${repo}`, [icon('github', 16), h('span', { class: 'nav-text' }, 'GitHub')], slot.className),
    );
  }
}

renderChrome();
// OAuth callback (?code=&state=): finish sign-in before the first render.
const signInResult = await completeSignIn();
try {
  extensions = await loadIndex();
  window.addEventListener('hashchange', render);
  render();
  if (signInResult && !signInResult.ok) {
    main.prepend(h('div', { class: 'callout danger' }, icon('alert', 18), h('span', {}, signInResult.error)));
  }
} catch (error) {
  main.replaceChildren(
    h('div', { class: 'empty' },
      h('h1', {}, '索引加载失败'),
      h('p', { class: 'callout danger' }, String(error.message ?? error)),
    ),
  );
}
