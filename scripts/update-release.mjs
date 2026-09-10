import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { releaseVersion, releaseAsset, expectedChecksum } from '../src/install.mjs';

export const releaseFiles = ['action.yml', 'package.json', 'src/default-version.mjs'];
const repository = 'stokaro/unswell-action';

function run(...args) {
  return execFileSync(args[0], args.slice(1), { encoding: 'utf8' }).trim();
}

export function compareVersions(left, right) {
  const parts = (value) => {
    const [core, ...suffix] = releaseVersion(value).split('-');
    return [...core.split('.'), ...(suffix.length ? suffix.join('-').split('.') : [])];
  };
  const a = parts(left), b = parts(right);
  for (let i = 0; i < 3; i++) {
    if (BigInt(a[i]) !== BigInt(b[i])) return BigInt(a[i]) > BigInt(b[i]) ? 1 : -1;
  }
  if (a.length === 3 || b.length === 3) return Number(a.length === 3) - Number(b.length === 3);
  for (let i = 3; i < Math.max(a.length, b.length); i++) {
    if (a[i] === undefined || b[i] === undefined) return a.length - b.length;
    if (a[i] === b[i]) continue;
    const an = /^\d+$/.test(a[i]), bn = /^\d+$/.test(b[i]);
    if (an && bn) {
      if (BigInt(a[i]) === BigInt(b[i])) continue;
      return BigInt(a[i]) > BigInt(b[i]) ? 1 : -1;
    }
    if (an !== bn) return an ? -1 : 1;
    return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}

export async function verifyArchives(assets, version) {
  const manifest = await readFile(path.join(assets, 'SHA256SUMS'), 'utf8');
  for (const platform of ['linux', 'darwin', 'win32']) {
    for (const architecture of ['x64', 'arm64']) {
      const { name } = releaseAsset(version, platform, architecture);
      const expected = expectedChecksum(manifest, name);
      const archive = await readFile(path.join(assets, name));
      if (createHash('sha256').update(archive).digest('hex') !== expected) {
        throw new Error(`Checksum mismatch: ${name}`);
      }
    }
  }
}

export function renderRelease(files, value) {
  const version = releaseVersion(value);
  const pattern = /(^  version:\r?\n(?:    [^\r\n]*\r?\n)*?    default: ')[^'\r\n]+('\r?\n)/gm;
  if ([...files['action.yml'].matchAll(pattern)].length !== 1) {
    throw new Error('Expected exactly one action version default.');
  }
  const pkg = JSON.parse(files['package.json']);
  if (compareVersions(version, pkg.version) < 0) throw new Error('Automatic updates cannot downgrade the release.');
  pkg.version = version;
  return {
    'action.yml': files['action.yml'].replace(pattern, (_, before, after) => before + version + after),
    'package.json': JSON.stringify(pkg, null, 2) + '\n',
    'src/default-version.mjs': `export const defaultVersion = '${version}';\n`,
  };
}

export function validateCandidate(changed, expected, actual) {
  if (!changed.length || changed.some((file) => !releaseFiles.includes(file))
      || releaseFiles.some((file) => expected[file] !== actual[file])) {
    throw new Error('The branch differs from the verified release update.');
  }
}

export function validatePull(pull, branch, author, head) {
  if (pull.baseRefName !== 'main' || pull.headRefName !== branch || pull.author.login !== author || !pull.author.is_bot
      || pull.isCrossRepository || pull.headRefOid !== head) {
    throw new Error('The PR is not the expected app update at the verified commit.');
  }
}

async function main() {
  const version = releaseVersion(process.env.RELEASE_VERSION);
  await verifyArchives('artifacts/release', version);
  const original = Object.fromEntries(await Promise.all(releaseFiles.map(async (file) => [file, await readFile(file, 'utf8')])));
  const expected = renderRelease(original, version);
  if (releaseFiles.every((file) => original[file] === expected[file])) {
    console.log(`The action already selects Unswell ${version}.`);
    return;
  }
  if (run('git', 'status', '--porcelain', '--untracked-files=no')) throw new Error('Expected a clean checkout.');
  const branch = `release/unswell-v${version}`;
  const author = process.env.PUBLISH_APP_SLUG + '[bot]';
  run('gh', 'auth', 'setup-git');
  let head;
  if (run('git', 'ls-remote', '--heads', 'origin', `refs/heads/${branch}`)) {
    run('git', 'fetch', 'origin', branch);
    const changed = run('git', 'diff', '--name-only', 'HEAD...FETCH_HEAD').split('\n');
    const actual = Object.fromEntries(releaseFiles.map((file) => [file, run('git', 'show', `FETCH_HEAD:${file}`) + '\n']));
    validateCandidate(changed, expected, actual);
    head = run('git', 'rev-parse', 'FETCH_HEAD');
  } else {
    run('git', 'switch', '-c', branch);
    for (const [file, text] of Object.entries(expected)) await writeFile(file, text);
    const userId = run('gh', 'api', `users/${author}`, '--jq', '.id');
    run('git', 'config', 'user.name', author);
    run('git', 'config', 'user.email', `${userId}+${author}@users.noreply.github.com`);
    run('git', 'add', '--', ...releaseFiles);
    run('git', 'commit', '-m', `Update default Unswell release to ${version}`);
    head = run('git', 'rev-parse', 'HEAD');
    run('git', 'push', 'origin', `HEAD:refs/heads/${branch}`);
  }
  const pulls = JSON.parse(run('gh', 'pr', 'list', '--repo', repository, '--head', branch, '--state', 'open', '--json', 'number'));
  if (pulls.length > 1) throw new Error('Multiple open release update PRs.');
  let number;
  if (pulls.length) {
    number = String(pulls[0].number);
  } else {
    const body = path.join(process.env.RUNNER_TEMP, 'action-release-pr.md');
    await writeFile(body, `Update the default CLI to [Unswell v${version}](https://github.com/stokaro/unswell/releases/tag/v${version}).\n\n`
      + 'All six archives match the published SHA-256 manifest. The required test jobs cover the action itself, and the consumer '
      + 'jobs run the selected public release on Linux, macOS and Windows. A maintainer then approves and squash-merges this pull '
      + 'request, updating the branch first when main has moved, because an update dismisses an earlier approval.\n');
    number = run('gh', 'pr', 'create', '--repo', repository, '--base', 'main', '--head', branch,
      '--title', `Update default Unswell release to ${version}`, '--body-file', body).split('/').at(-1);
  }
  const pull = JSON.parse(run('gh', 'pr', 'view', number, '--repo', repository, '--json',
    'baseRefName,headRefName,headRefOid,author,isCrossRepository'));
  validatePull(pull, branch, 'app/' + process.env.PUBLISH_APP_SLUG, head);
  await writeFile(process.env.GITHUB_STEP_SUMMARY,
    `[Action release PR](https://github.com/${repository}/pull/${number}) opened for review. Update its branch if main has moved, `
    + 'then approve and squash-merge it once the required checks pass.\n',
    { flag: 'a' });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
