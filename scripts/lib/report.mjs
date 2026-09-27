// PR comment text for the submission check.

export const REPORT_MARKER = '<!-- piwin-extensions:validate -->';

export function renderReport({ problems, checkedIds, versionsToCheck, forkLinks }) {
  const lines = [REPORT_MARKER];
  if (problems.length === 0) {
    lines.push('### ✅ 条目检查通过 / Entry check passed', '');
  } else {
    lines.push(`### ❌ 发现 ${problems.length} 个问题 / ${problems.length} problem(s)`, '');
    for (const problem of problems) lines.push(`- ${problem}`);
    lines.push('');
  }
  if (checkedIds.length > 0) {
    lines.push(`检查的条目 / Entries: ${checkedIds.map((id) => `\`${id}\``).join(', ')}`);
  }
  if (versionsToCheck.length > 0) {
    lines.push('', '新版本源码 / New versions:');
    for (const version of versionsToCheck) {
      const url = version.subdir
        ? `${version.repository}/tree/${version.commit}/${version.subdir}`
        : `${version.repository}/commit/${version.commit}`;
      lines.push(`- \`${version.id}\` ${version.version} → [${version.commit.slice(0, 12)}](${url})`);
    }
  }
  if (forkLinks.length > 0) {
    lines.push('', '改装对照 / Fork comparison:');
    for (const fork of forkLinks) {
      lines.push(
        `- \`${fork.id}\` ${fork.modified.version}：[改装版 / modified](${fork.modified.url}) ← 基于 \`${fork.original.id}\` ${fork.original.version}：[原版 / original](${fork.original.url})`,
      );
    }
  }
  lines.push(
    '',
    '<sub>通过检查只代表结构合规，不等于安全审查。Passing is a structural check, not a security review.</sub>',
  );
  return `${lines.join('\n')}\n`;
}
