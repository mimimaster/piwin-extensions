#!/usr/bin/env node
// CI gate for submission PRs. Runs from the BASE checkout; the head checkout
// is read as data only, so a PR cannot weaken the rules that judge it.
//
//   node base/scripts/validate-pr.mjs --base base --head head --author <login> [--skip-fetch]
import { parseArgs } from 'node:util';
import { checkPullRequest } from './lib/pr-rules.mjs';
import { changedFiles, readEntries } from './lib/registry-tree.mjs';
import { checkPinnedSource } from './lib/source-check.mjs';

const { values } = parseArgs({
  options: {
    base: { type: 'string' },
    head: { type: 'string' },
    author: { type: 'string' },
    'skip-fetch': { type: 'boolean', default: false },
  },
});
if (!values.base || !values.head || !values.author) {
  console.error('usage: validate-pr.mjs --base <dir> --head <dir> --author <login> [--skip-fetch]');
  process.exit(2);
}

async function isPublicOrgMember(org, user) {
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'piwin-extensions-ci' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(`https://api.github.com/orgs/${org}/public_members/${user}`, { headers });
  return response.status === 204;
}

const [base, head, changed] = await Promise.all([
  readEntries(values.base),
  readEntries(values.head),
  changedFiles(values.base, values.head),
]);
const { problems, versionsToCheck } = await checkPullRequest({
  base: base.entries,
  head: head.entries,
  headStrayFiles: head.strayFiles,
  changed,
  author: values.author,
  isPublicOrgMember,
});

if (!values['skip-fetch']) {
  for (const version of versionsToCheck) {
    const label = `extensions/${version.id}.json ${version.version}`;
    console.log(`checking ${label} → ${version.repository}@${version.commit}${version.subdir ? `/${version.subdir}` : ''}`);
    for (const problem of await checkPinnedSource(version)) problems.push(`${label}: ${problem}`);
  }
}

if (changed.length === 0) console.log('no registry changes');
if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  process.exit(1);
}
console.log(`ok: ${changed.length} file(s) changed, ${versionsToCheck.length} new version(s) checked`);
