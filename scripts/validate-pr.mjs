#!/usr/bin/env node
// Submission PR check. In CI it runs on pull_request_target from the BASE
// checkout and reads the PR's files through the GitHub API as data, so a PR
// cannot change the rules that judge it and none of its content is executed.
//
//   CI:     node scripts/validate-pr.mjs --github            (uses GITHUB_* env)
//   Local:  node scripts/validate-pr.mjs --base <dir> --head <dir> --author <login> [--skip-fetch]
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { createGitHubClient } from './lib/github.mjs';
import { checkPullRequest } from './lib/pr-rules.mjs';
import { REPORT_MARKER, renderReport } from './lib/report.mjs';
import { changedFiles, readEntries } from './lib/registry-tree.mjs';
import { checkPinnedSource } from './lib/source-check.mjs';

const { values } = parseArgs({
  options: {
    github: { type: 'boolean', default: false },
    base: { type: 'string', default: '.' },
    head: { type: 'string' },
    author: { type: 'string' },
    'skip-fetch': { type: 'boolean', default: false },
  },
});

const { changes, author, isPublicOrgMember, postComment } = values.github
  ? await loadFromGitHub()
  : await loadFromDirectories();

const { entries: baseEntries } = await readEntries(values.base);
const result = await checkPullRequest({ baseEntries, changes, author, isPublicOrgMember });

if (!values['skip-fetch']) {
  for (const version of result.versionsToCheck) {
    const label = `extensions/${version.id}.json ${version.version}`;
    console.log(`fetching ${version.repository}@${version.commit}${version.subdir ? ` (${version.subdir})` : ''}`);
    for (const problem of await checkPinnedSource(version)) result.problems.push(`${label}: ${problem}`);
  }
}

const report = renderReport(result);
console.log(report);
if (postComment) await postComment(report);
process.exit(result.problems.length > 0 ? 1 : 0);

async function loadFromGitHub() {
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const pull = event.pull_request;
  const repo = process.env.GITHUB_REPOSITORY;
  const github = createGitHubClient(process.env.GITHUB_TOKEN);
  const files = await github.listPullFiles(repo, pull.number);
  const headRepo = pull.head.repo.full_name;
  const loaded = [];
  for (const file of files) {
    if (file.status === 'renamed' && file.previous_filename) {
      loaded.push({ path: file.previous_filename, content: null });
    }
    const removed = file.status === 'removed';
    // Only entry-shaped JSON is read; anything else is judged by path alone.
    const readable = !removed && file.filename.startsWith('extensions/') && file.filename.endsWith('.json');
    loaded.push({
      path: file.filename,
      content: removed ? null : readable ? await github.readFile(headRepo, file.filename, pull.head.sha) : '',
    });
  }
  return {
    changes: loaded,
    author: pull.user.login,
    isPublicOrgMember: (org, user) => github.isPublicOrgMember(org, user),
    postComment: (body) => github.upsertComment(repo, pull.number, REPORT_MARKER, body),
  };
}

async function loadFromDirectories() {
  if (!values.head || !values.author) {
    console.error('usage: validate-pr.mjs --github | --base <dir> --head <dir> --author <login> [--skip-fetch]');
    process.exit(2);
  }
  const paths = await changedFiles(values.base, values.head);
  const changes = [];
  for (const path of paths) {
    const content = await readFile(join(values.head, path), 'utf8').catch(() => null);
    changes.push({ path, content });
  }
  return { changes, author: values.author, isPublicOrgMember: async () => false, postComment: undefined };
}
