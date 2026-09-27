// Drop target + pickers. Hands back normalized files, never raw input.
import { h } from './dom.js';
import { filesFromDrop, filesFromInput, normalizeUpload } from './upload-files.js';
import { icon } from './ui.js';

/**
 * @param {(upload: ReturnType<typeof normalizeUpload>) => void} onUpload
 * @param {(error: Error) => void} onError
 */
export function dropzone(onUpload, onError, { compact = false } = {}) {
  const folderInput = h('input', { type: 'file', webkitdirectory: true, multiple: true, hidden: true });
  const fileInput = h('input', { type: 'file', multiple: true, accept: '.ts,.zip,.json,.md', hidden: true });
  const take = async (collect) => {
    try {
      const upload = normalizeUpload(await collect());
      if (upload.files.length === 0) throw new Error('没有读到文件。');
      onUpload(upload);
    } catch (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
    }
  };
  folderInput.addEventListener('change', () => take(() => filesFromInput(folderInput.files)));
  fileInput.addEventListener('change', () => take(() => filesFromInput(fileInput.files)));

  const zone = h('div', { class: `dropzone${compact ? ' compact' : ''}`, tabindex: '0', role: 'button', 'aria-label': '拖入扩展文件夹、zip 或 .ts 文件' },
    h('span', { class: 'dropzone-icon' }, icon('download', compact ? 22 : 30)),
    h('strong', {}, '把扩展文件夹拖到这里'),
    h('span', { class: 'fine' }, '也可以拖入 zip，或单个 .ts 文件'),
    h('div', { class: 'dropzone-actions' },
      h('button', { type: 'button', class: 'button secondary', onClick: (event) => { event.stopPropagation(); folderInput.click(); } }, '选择文件夹'),
      h('button', { type: 'button', class: 'button secondary', onClick: (event) => { event.stopPropagation(); fileInput.click(); } }, '选择文件或 zip'),
    ),
    folderInput,
    fileInput,
  );
  zone.addEventListener('click', () => folderInput.click());
  zone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      folderInput.click();
    }
  });
  zone.addEventListener('dragover', (event) => {
    event.preventDefault();
    zone.classList.add('is-over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    zone.classList.remove('is-over');
    take(() => filesFromDrop(event.dataTransfer));
  });
  return zone;
}
