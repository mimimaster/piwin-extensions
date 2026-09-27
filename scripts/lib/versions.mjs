// Version ordering for the published index: newest first.

const SEMVER = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Semver precedence (missing minor/patch count as 0). Returns 0 when either
 * side is not semver-like, so a stable sort keeps the file's order for them.
 */
export function compareVersions(left, right) {
  const a = SEMVER.exec(left);
  const b = SEMVER.exec(right);
  if (!a || !b) return 0;
  for (let index = 1; index <= 3; index += 1) {
    const diff = Number(a[index] ?? 0) - Number(b[index] ?? 0);
    if (diff !== 0) return diff;
  }
  const preA = a[4];
  const preB = b[4];
  if (preA === undefined || preB === undefined) {
    if (preA === preB) return 0;
    return preA === undefined ? 1 : -1; // a release outranks its prereleases
  }
  const partsA = preA.split('.');
  const partsB = preB.split('.');
  for (let index = 0; index < Math.max(partsA.length, partsB.length); index += 1) {
    const x = partsA[index];
    const y = partsB[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const numericX = /^\d+$/.test(x);
    const numericY = /^\d+$/.test(y);
    if (numericX && numericY) {
      const diff = Number(x) - Number(y);
      if (diff !== 0) return diff;
    } else if (numericX !== numericY) {
      return numericX ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/** Newest first; non-semver versions keep their relative file order. */
export function sortVersionsNewestFirst(versions) {
  return versions
    .map((version, position) => ({ version, position }))
    .sort((left, right) => {
      const byVersion = compareVersions(right.version.version, left.version.version);
      return byVersion !== 0 ? byVersion : left.position - right.position;
    })
    .map((item) => item.version);
}
