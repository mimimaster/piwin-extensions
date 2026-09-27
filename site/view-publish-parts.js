// Account bar, publish progress and result, shared by the upload page and
// the "upload a new version" panel.
import { getToken, signIn, signOut } from './auth.js';
import { signInConfigured } from './config.js';
import { externalLink, h } from './dom.js';
import { PUBLISH_STEPS } from './publish-flow.js';
import { avatar, icon } from './ui.js';

let cachedUser = null;

/** Current signed-in login, or null. One /user call per page load. */
export async function currentLogin() {
  const token = getToken();
  if (!token) return null;
  if (cachedUser?.token === token) return cachedUser.login;
  const response = await fetch('https://api.github.com/user', {
    headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    signOut();
    return null;
  }
  const login = (await response.json()).login;
  cachedUser = { token, login };
  return login;
}

export function accountBar(onChange) {
  const bar = h('div', { class: 'account-bar' });
  const render = async () => {
    if (!signInConfigured()) {
      bar.replaceChildren(
        h('div', { class: 'callout warn' }, icon('alert', 18),
          h('span', {}, 'GitHub 登录还在配置中，暂时不能一键发布。现在可以先拖入文件检查，或用 ', h('a', { href: '#/submit/manual' }, '手动填写'), '。')),
      );
      onChange(null);
      return;
    }
    const login = await currentLogin().catch(() => null);
    if (!login) {
      bar.replaceChildren(
        h('div', { class: 'account-signin' },
          h('button', { type: 'button', class: 'button', onClick: () => signIn() }, icon('github', 16), '用 GitHub 登录'),
          h('details', { class: 'why' },
            h('summary', {}, '为什么需要 public_repo 权限？'),
            h('p', {}, '一键发布会以你的身份做三件事：在你的账号下创建放源码的公开仓库并推送文件、fork 扩展仓库、以你的名义开 PR。GitHub 能覆盖这三件事的最小 OAuth 权限就是 public_repo（可以写你的公开仓库，读不到私有仓库）。'),
            h('p', {}, 'token 只保存在这个浏览器标签页里（sessionStorage），关掉标签页就没了；我们的服务器不保存、不记录。随时可以在 ',
              externalLink('https://github.com/settings/applications', 'GitHub → Settings → Applications'), ' 撤销授权。'),
          ),
        ),
      );
      onChange(null);
      return;
    }
    bar.replaceChildren(
      h('div', { class: 'account-user' },
        avatar(login, 28),
        h('span', {}, '已登录 ', h('strong', {}, login)),
        h('button', { type: 'button', class: 'link-button', onClick: () => { signOut(); render(); } }, '退出'),
        externalLink('https://github.com/settings/applications', '管理授权', 'fine'),
      ),
    );
    onChange(login);
  };
  render();
  return bar;
}

/** Live step list; returns { element, onStep, fail, done }. */
export function progressList() {
  const items = new Map();
  const element = h('ol', { class: 'progress' },
    PUBLISH_STEPS.map(([key, label]) => {
      const detail = h('span', { class: 'fine' });
      const item = h('li', { class: 'progress-item is-waiting' }, h('span', { class: 'progress-dot' }), h('div', {}, h('strong', {}, label), detail));
      items.set(key, { item, detail });
      return item;
    }),
  );
  let active = null;
  return {
    element,
    onStep(key, detailText) {
      if (active && active !== key) items.get(active).item.className = 'progress-item is-done';
      active = key;
      const current = items.get(key);
      current.item.className = 'progress-item is-active';
      if (detailText) current.detail.textContent = detailText;
    },
    fail() {
      if (active) items.get(active).item.className = 'progress-item is-failed';
    },
    done() {
      for (const { item } of items.values()) item.className = 'progress-item is-done';
    },
  };
}

export function resultCard(result) {
  return h('div', { class: 'publish-result' },
    h('div', { class: 'callout ok' }, icon('check', 18), h('strong', {}, '已提交！PR 已经开好')),
    h('div', { class: 'actions' },
      externalLink(result.prUrl, [icon('github', 16), ` 查看 PR #${result.prNumber}`], 'button'),
      externalLink(`${result.repository}/commit/${result.commit}`, ['源码 commit ', icon('external', 14)], 'button secondary'),
    ),
    h('p', { class: 'fine' }, 'CI 大约一分钟内会在 PR 上贴出检查结果；维护者合并后几分钟，桌面端扩展市场就能搜到。'),
  );
}
