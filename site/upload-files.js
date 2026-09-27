// Turn a drop or a file picker selection into { path, bytes } files, then
// normalize: one top-level folder is unwrapped, junk is skipped, and a lone
// .ts file becomes index.ts.
import { readZip } from './zip-reader.js';

const SKIPPED_SEGMENTS = new Set(['.git', 'node_modules', '__MACOSX', '.DS_Store', 'Thumbs.db']);

/** Files from <input type=file> (webkitdirectory keeps relative paths). */
export async function filesFromInput(fileList) {
  return expandZips(
    await Promise.all(
      [...fileList].map(async (file) => ({
        path: file.webkitRelativePath || file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      })),
    ),
  );
}

/** Files from a drag and drop, walking dropped folders. */
export async function filesFromDrop(dataTransfer) {
  const entries = [...dataTransfer.items].map((item) => item.webkitGetAsEntry?.()).filter(Boolean);
  if (entries.length === 0) return filesFromInput(dataTransfer.files);
  const files = [];
  for (const entry of entries) await walkEntry(entry, '', files);
  return expandZips(files);
}

async function walkEntry(entry, prefix, files) {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    files.push({ path, bytes: new Uint8Array(await file.arrayBuffer()) });
    return;
  }
  if (!entry.isDirectory || SKIPPED_SEGMENTS.has(entry.name)) return;
  const reader = entry.createReader();
  // readEntries returns batches until an empty one.
  for (;;) {
    const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) break;
    for (const child of batch) await walkEntry(child, path, files);
  }
}

async function expandZips(files) {
  if (files.length === 1 && files[0].path.toLowerCase().endsWith('.zip')) {
    return readZip(files[0].bytes.buffer.slice(files[0].bytes.byteOffset, files[0].bytes.byteOffset + files[0].bytes.byteLength));
  }
  return files;
}

/**
 * @returns {{ files: Array<{ path, bytes, symlink? }>, skipped: string[], rootName: string | null }}
 */
export function normalizeUpload(rawFiles) {
  const skipped = [];
  let files = [];
  for (const file of rawFiles) {
    const path = file.path.replace(/\\/g, '/').replace(/^\/+/, '');
    const segments = path.split('/');
    if (segments.some((segment) => segment === '..' || segment === '')) {
      skipped.push(file.path);
      continue;
    }
    if (segments.some((segment) => SKIPPED_SEGMENTS.has(segment))) {
      skipped.push(path);
      continue;
    }
    files.push({ ...file, path });
  }
  // Unwrap a single top-level folder ("my-extension/index.ts" → "index.ts").
  let rootName = null;
  const tops = new Set(files.map((file) => file.path.split('/')[0]));
  if (tops.size === 1 && files.every((file) => file.path.includes('/'))) {
    rootName = [...tops][0];
    files = files.map((file) => ({ ...file, path: file.path.slice(rootName.length + 1) }));
  }
  // A lone module is staged as the extension entry.
  const tsFiles = files.filter((file) => file.path.endsWith('.ts') && !file.path.endsWith('.d.ts'));
  if (!files.some((file) => file.path === 'index.ts') && tsFiles.length === 1 && !tsFiles[0].path.includes('/')) {
    rootName ??= tsFiles[0].path.replace(/\.ts$/, '');
    files = files.map((file) => (file === tsFiles[0] ? { ...file, path: 'index.ts' } : file));
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  return { files, skipped, rootName };
}

/** Text files go into the tree inline; anything else becomes a base64 blob. */
export function decodeText(bytes) {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
