// What we can know about an upload before anything leaves the browser:
// the CI's source rules on its listing, and metadata from package.json.
import { SOURCE_LIMITS, checkPackageJsonText, checkSourceListing } from './lib/source-rules.mjs';
import { toSlug, toTitle } from './submit-autofill.js';

/** Most one-click uploads are a handful of files; beyond this, use git. */
export const MAX_UPLOAD_FILES = 300;

/**
 * @param {{ files: Array<{ path, bytes, symlink? }>, rootName: string | null }} upload
 * @returns {{ problems: string[], meta: object, fileCount: number, totalBytes: number }}
 */
export function inspectUpload(upload) {
  const listing = [];
  const directories = new Set();
  for (const file of upload.files) {
    const segments = file.path.split('/');
    for (let depth = 1; depth < segments.length; depth += 1) directories.add(segments.slice(0, depth).join('/'));
    listing.push({ path: file.path, kind: file.symlink ? 'symlink' : 'file', size: file.bytes.length });
  }
  for (const path of directories) listing.push({ path, kind: 'dir' });

  const problems = [...checkSourceListing(listing, undefined).problems];
  const packageFile = upload.files.find((file) => file.path === 'package.json');
  let pkg = null;
  if (packageFile) {
    const raw = new TextDecoder().decode(packageFile.bytes);
    problems.push(...checkPackageJsonText(raw));
    try {
      pkg = JSON.parse(raw);
    } catch {
      pkg = null;
    }
  }
  if (upload.files.length > MAX_UPLOAD_FILES) {
    problems.push(`一键上传最多 ${MAX_UPLOAD_FILES} 个文件；更大的项目请用 git 推送后走「手动填写」。`);
  }
  const totalBytes = upload.files.reduce((sum, file) => sum + file.bytes.length, 0);
  return {
    problems,
    meta: metaFrom(pkg, upload.rootName),
    fileCount: upload.files.length,
    totalBytes,
    limits: SOURCE_LIMITS,
  };
}

function metaFrom(pkg, rootName) {
  const packageName = typeof pkg?.name === 'string' ? pkg.name.replace(/^@[^/]+\//, '') : '';
  const base = packageName || rootName || 'my-extension';
  const keywords = Array.isArray(pkg?.keywords)
    ? pkg.keywords.filter((keyword) => typeof keyword === 'string' && keyword.length <= 40 && keyword !== 'pi-package').slice(0, 20)
    : [];
  return {
    slug: toSlug(base) || 'my-extension',
    name: typeof pkg?.displayName === 'string' ? pkg.displayName.slice(0, 80) : toTitle(base) || 'My Extension',
    description: typeof pkg?.description === 'string' ? pkg.description.slice(0, 500) : '',
    version: typeof pkg?.version === 'string' ? pkg.version : '0.1.0',
    license: typeof pkg?.license === 'string' ? pkg.license : '',
    keywords,
    homepage: typeof pkg?.homepage === 'string' && pkg.homepage.startsWith('https://') ? pkg.homepage : '',
  };
}
