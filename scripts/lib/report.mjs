// PR comment text for the submission check.

export const REPORT_MARKER = '<!-- piwin-extensions:validate -->';

export function renderReport({ problems, checkedIds, versionsToCheck, forkLinks, isNonSubmission }) {
  const lines = [REPORT_MARKER];
  if (isNonSubmission) {
    lines.push(
      '### ✅ 仓库维护变更检查通过 / Maintenance PR check passed',
      '',
      '此 PR 未修改 `extensions/` 目录下的条目，已跳过条目规范与源码 commit 校验。',
      'This PR does not modify any extension entries under `extensions/`. Entry and commit validation skipped.',
      '',
      '<sub>仓库维护类变更需由维护者审查合并。Maintenance PRs are reviewed and merged by repository maintainers.</sub>',
    );
    return `${lines.join('\n')}\n`;
  }
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
