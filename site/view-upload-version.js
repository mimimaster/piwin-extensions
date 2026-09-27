// Detail page: owners drop the new code and publish a version in one click.
import { getToken } from './auth.js';
import { registryRepo, signInConfigured } from './config.js';
import { h } from './dom.js';
import { describeProblem } from './problem-text.js';
import { publishNewVersion } from './publish-flow.js';
import { dropzone } from './upload-dropzone.js';
import { inspectUpload } from './upload-inspect.js';
import { icon } from './ui.js';
import { accountBar, progressList, resultCard } from './view-publish-parts.js';

export function uploadVersionPanel(entry) {
  let login = null;
  const stage = h('div', {});
  const note = h('p', { class: 'fine' });
  const bar = accountBar((value) => {
    login = value;
    note.textContent = login && !entry.owners.includes(login.toLowerCase())
      ? `你（${login}）不是这个扩展的维护者，不能发新版本。`
      : '';
  });
  const zone = dropzone(
    (upload) => renderReview(upload),
    (error) => stage.replaceChildren(h('div', { class: 'callout danger' }, icon('alert', 18), h('span', {}, error.message))),
    { compact: true },
  );

  function renderReview(upload) {
    const inspected = inspectUpload(upload);
    const problems = inspected.problems.map((problem) => describeProblem(problem).text);
    const published = new Set(entry.versions.map((version) => version.version));
    const versionInput = h('input', {
      class: 'mono',
      value: published.has(inspected.meta.version) ? '' : inspected.meta.version,
      placeholder: '新版本号',
    });
    const button = h('button', { type: 'button', class: 'button' }, icon('send', 16), '发布这个版本');
    const reason = h('span', { class: 'fine' });
    const progressSlot = h('div', {});
    const check = () => {
      const version = versionInput.value.trim();
      const why = !signInConfigured()
        ? 'GitHub 登录还在配置中'
        : !login
          ? '先用 GitHub 登录'
          : !entry.owners.includes(login.toLowerCase())
            ? '只有维护者能发版本'
            : problems.length > 0
              ? '先修好源码问题'
              : !/^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/.test(version)
                ? '填一个新版本号'
                : published.has(version)
                  ? `${version} 已经发布过`
                  : '';
      button.disabled = Boolean(why);
      reason.textContent = why;
    };
    versionInput.addEventListener('input', check);
    button.addEventListener('click', async () => {
      const progress = progressList();
      progressSlot.replaceChildren(progress.element);
      button.disabled = true;
      try {
        const result = await publishNewVersion({
          token: getToken(),
          entry,
          files: upload.files,
          version: versionInput.value.trim(),
          registry: registryRepo(),
          onStep: progress.onStep,
        });
        progress.done();
        progressSlot.append(resultCard(result));
      } catch (error) {
        progress.fail();
        progressSlot.append(h('div', { class: 'callout danger' }, icon('alert', 18), h('span', {}, error.message)));
        button.disabled = false;
      }
    });
    stage.replaceChildren(
      h('p', { class: 'fine' }, `${inspected.fileCount} 个文件${entry.subdir ? `，会替换仓库里的 ${entry.subdir}` : '，会替换仓库里的源码（README、LICENSE、.github 保留）'}`),
      problems.length === 0
        ? h('div', { class: 'callout ok' }, icon('check', 18), h('span', {}, '源码检查通过'))
        : h('div', { class: 'callout danger' }, icon('alert', 18), h('span', {}, problems.join('；'))),
      h('div', { class: 'publish-row' }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, '版本号'), versionInput), button, reason),
      progressSlot,
    );
    check();
  }

  return h('details', { class: 'panel maintainer' },
    h('summary', {}, h('span', {}, '我是作者：上传新版本'), icon('arrowRight', 16)),
    h('div', { class: 'upload-version' }, bar, note, zone, stage),
  );
}
