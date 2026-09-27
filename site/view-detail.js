// Extension page: header, versions, install card, facts, maintainer panel.
import { registryRepo } from './config.js';
import { copyButton, externalLink, h } from './dom.js';
import { buildUpdate, commitUrl, editFileUrl } from './entry-builder.js';
import { fetchHeadCommit, fetchRepository, parseRepositoryInput } from './github-api.js';
import { describeProblem } from './problem-text.js';
import { inspectSource } from './source-inspect.js';
import { latestInstallable } from './search.js';
import { avatar, chip, icon } from './ui.js';
import { resultBlock } from './view-result.js';
import { uploadVersionPanel } from './view-upload-version.js';

export function detailView(entry, extensions) {
  if (!entry) {
    return h('div', { class: 'empty' },
      h('h1', {}, '没有这个扩展'),
      h('a', { href: '#/', class: 'button secondary' }, icon('arrowLeft', 16), '回到全部扩展'),
    );
  }
  const latest = latestInstallable(entry);
  const base = entry.forkOf ? extensions.find((item) => item.id === entry.forkOf.id) : undefined;
  const baseVersion = base?.versions.find((version) => version.version === entry.forkOf.version);

  return h(
    'div',
    { class: 'detail' },
    h('a', { href: '#/', class: 'back' }, icon('arrowLeft', 16), '全部扩展'),
    h('header', { class: 'detail-head' },
      h('div', { class: 'detail-title' },
        h('h1', {}, entry.name),
        h('p', { class: 'detail-id' }, entry.id),
      ),
      h('div', { class: 'detail-chips' },
        latest ? chip(`v${latest.version}`, { tone: 'accent', iconName: 'tag' }) : chip('已全部撤回', { tone: 'danger' }),
        chip(entry.license, { iconName: 'scale' }),
        entry.forkOf ? chip('改装版', { tone: 'amber', iconName: 'fork' }) : null,
      ),
      entry.description ? h('p', { class: 'detail-lead' }, entry.description) : null,
    ),
    entry.forkOf
      ? h('div', { class: 'fork-note' },
          icon('fork', 18),
          h('p', {},
            '基于 ',
            base ? h('a', { href: `#/ext/${base.id}` }, entry.forkOf.id) : h('strong', {}, entry.forkOf.id),
            ` ${entry.forkOf.version} 改装。`,
            baseVersion ? ['安装前建议对照 ', externalLink(commitUrl(base, baseVersion.commit), '原版源码'), ' 看看改了什么。'] : null,
          ),
        )
      : null,
    h('div', { class: 'detail-grid' },
      h('div', { class: 'detail-main' },
        h('section', { class: 'block' }, h('h2', {}, '版本'), versionTimeline(entry)),
        uploadVersionPanel(entry),
        maintainerPanel(entry),
      ),
      h('aside', { class: 'detail-aside' },
        installCard(entry, latest),
        factsCard(entry),
      ),
    ),
  );
}

function installCard(entry, latest) {
  if (!latest) {
    return h('div', { class: 'panel notice' }, icon('alert', 18), '所有版本都已撤回，暂时不能安装。');
  }
  return h('div', { class: 'panel install' },
    h('h2', {}, '安装'),
    h('p', { class: 'muted' }, '桌面端：扩展市场里搜索名称，点「安装」。'),
    h('p', { class: 'muted' }, 'CLI 暂不使用。'),
    h('p', { class: 'fine' }, icon('pin', 14), `固定到 commit ${latest.commit.slice(0, 12)}`),
  );
}

function factsCard(entry) {
  const row = (label, value) => [h('dt', {}, label), h('dd', {}, value)];
  return h('div', { class: 'panel' },
    h('h2', {}, '信息'),
    h('dl', { class: 'facts' },
      row('作者', h('span', { class: 'owners' },
        entry.owners.map((owner) => h('span', { class: 'owner' }, avatar(owner, 20), owner)))),
      row('源码', externalLink(entry.repository, [icon('github', 14), ` ${entry.repository.replace('https://github.com/', '')}`])),
      entry.subdir ? row('路径', h('code', {}, entry.subdir)) : null,
      entry.homepage ? row('主页', externalLink(entry.homepage, entry.homepage.replace(/^https:\/\//, ''))) : null,
      entry.keywords?.length ? row('关键词', h('span', { class: 'chips' }, entry.keywords.map((keyword) => chip(`#${keyword}`, { tone: 'ghost' })))) : null,
    ),
  );
}

function versionTimeline(entry) {
  return h('ol', { class: 'timeline' },
    entry.versions.map((version, index) =>
      h('li', { class: `timeline-item${version.yanked ? ' is-yanked' : ''}${index === 0 ? ' is-first' : ''}` },
        h('span', { class: 'timeline-dot', 'aria-hidden': 'true' }),
        h('div', { class: 'timeline-body' },
          h('div', { class: 'timeline-head' },
            h('strong', {}, version.version),
            version.yanked ? chip('已撤回', { tone: 'danger' }) : null,
            version.publishedAt ? h('span', { class: 'muted' }, version.publishedAt.slice(0, 10)) : null,
          ),
          h('div', { class: 'timeline-meta' },
            externalLink(commitUrl(entry, version.commit), [icon('pin', 13), ` ${version.commit.slice(0, 12)}`]),
            version.yanked ? h('span', { class: 'yank-reason' }, `原因：${version.yanked.reason}`) : null,
          ),
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
    yankReason: h('input', { placeholder: '为什么撤回', 'aria-label': '撤回原因' }),
  };
  const output = h('div', { class: 'output' });
  const sourceStatus = h('div', { class: 'source-status', 'aria-live': 'polite' });
  const parsedRepo = parseRepositoryInput(entry.repository);

  /** Fill the default branch head, then check it with the CI's source rules. */
  const latestButton = h('button', { type: 'button', class: 'inline-action' }, '用最新 commit');
  latestButton.addEventListener('click', async () => {
    latestButton.disabled = true;
    sourceStatus.replaceChildren(h('p', { class: 'fine' }, h('span', { class: 'spinner' }), '读取最新 commit 并检查源码…'));
    try {
      const info = await fetchRepository(parsedRepo.owner, parsedRepo.repo);
      const commit = await fetchHeadCommit(parsedRepo.owner, parsedRepo.repo, info.defaultBranch);
      fields.commit.value = commit;
      const result = await inspectSource({ repository: entry.repository, commit, subdir: entry.subdir });
      if (!fields.version.value && result.packageVersion) fields.version.value = result.packageVersion;
      const published = entry.versions.find((version) => version.commit === commit);
      sourceStatus.replaceChildren(
        published
          ? h('div', { class: 'callout warn' }, icon('alert', 18), h('span', {}, `这个 commit 已经发布为 ${published.version}，先推送新的提交。`))
          : result.problems.length > 0
            ? h('div', { class: 'callout danger' }, icon('alert', 18),
                h('span', {}, result.problems.map((problem) => describeProblem(problem).text).join('；')))
            : h('div', { class: 'callout ok' }, icon('check', 18),
                h('span', {}, `源码检查通过 · ${info.defaultBranch}@${commit.slice(0, 12)}${result.packageVersion ? ` · package.json ${result.packageVersion}` : ''}`)),
      );
    } catch (error) {
      sourceStatus.replaceChildren(h('div', { class: 'callout danger' }, icon('alert', 18), h('span', {}, error.message)));
    } finally {
      latestButton.disabled = false;
    }
  });

  const generate = () => {
    const result = buildUpdate(entry, {
      version: fields.version.value,
      commit: fields.commit.value,
      stampDate: fields.stampDate.checked,
      yankVersion: fields.yankVersion.value,
      yankReason: fields.yankReason.value,
    });
    output.replaceChildren(...resultBlock(result.problems, result.text, [
      copyButton('复制完整 JSON', result.text, 'button'),
      externalLink(editFileUrl(repo, entry.id), ['打开 GitHub 编辑页 ', icon('external', 14)], 'button secondary'),
    ], 'GitHub 编辑页不能预填：打开后全选，粘贴上面的 JSON，再点 “Propose changes”。只有 owners 里的账号提的 PR 会通过检查。'));
  };
  return h(
    'details',
    { class: 'panel maintainer' },
    h('summary', {}, h('span', {}, '手动：填 commit 发版本 / 撤回版本'), icon('arrowRight', 16)),
    h('div', { class: 'form-grid two' },
      field('新版本号', fields.version),
      field(h('span', { class: 'field-label' }, '新版本 commit', parsedRepo ? latestButton : null), fields.commit),
      field('撤回某个版本', fields.yankVersion),
      field('撤回原因', fields.yankReason),
      h('label', { class: 'check' }, fields.stampDate, '写入发布时间'),
    ),
    sourceStatus,
    h('button', { type: 'button', class: 'button', onClick: generate }, '生成更新后的条目'),
    output,
  );
}

function field(label, control) {
  return h('label', { class: 'field' }, typeof label === 'string' ? h('span', { class: 'field-label' }, label) : label, control);
}
