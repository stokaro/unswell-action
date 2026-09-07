import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { releaseAsset } from '../src/install.mjs';
import { compareVersions, releaseFiles, renderRelease, validateCandidate, validatePull, verifyArchives } from '../scripts/update-release.mjs';

test('update the action metadata and executable default together', async () => {
  const original = Object.fromEntries(await Promise.all(releaseFiles.map(async (file) => [file, await readFile(file, 'utf8')])));
  // Keep the updater fixture independent of future published defaults.
  original['package.json'] = JSON.stringify({ ...JSON.parse(original['package.json']), version: '0.1.0-alpha.1' });
  const updated = renderRelease(original, 'v0.2.0-alpha.2');
  assert.match(updated['action.yml'], /default: '0.2.0-alpha.2'/);
  assert.equal(JSON.parse(updated['package.json']).version, '0.2.0-alpha.2');
  assert.equal(updated['src/default-version.mjs'], "export const defaultVersion = '0.2.0-alpha.2';\n");
  assert.deepEqual(renderRelease(updated, '0.2.0-alpha.2'), updated);
  assert.throws(() => renderRelease(updated, '0.1.0'), /downgrade/);
  assert.throws(() => renderRelease(original, '../main'));
  assert.throws(() => renderRelease({ ...original, 'action.yml': '' }, '0.2.0'));
  validateCandidate(releaseFiles, updated, updated);
  assert.throws(() => validateCandidate([], updated, updated));
  assert.throws(() => validateCandidate([...releaseFiles, '.github/workflows/ci.yml'], updated, updated));
  assert.throws(() => validateCandidate(releaseFiles, updated, original));
});

test('release ordering preserves stable and numeric prerelease precedence', () => {
  const versions = ['0.1.0-alpha.1', '0.1.0-alpha.2', '0.1.0-alpha.10', '0.1.0', '0.2.0-alpha.1'];
  assert.deepEqual([...versions].reverse().sort(compareVersions), versions);
});

test('all six archive checksums must pass, including non-host platforms', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'unswell-release-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const entries = [];
  let lastName;
  for (const platform of ['linux', 'darwin', 'win32']) {
    for (const architecture of ['x64', 'arm64']) {
      const { name } = releaseAsset('0.2.0', platform, architecture);
      await writeFile(path.join(directory, name), name);
      entries.push(`${createHash('sha256').update(name).digest('hex')}  ${name}\n`);
      lastName = name;
    }
  }
  await writeFile(path.join(directory, 'SHA256SUMS'), entries.join(''));
  await verifyArchives(directory, '0.2.0');
  await writeFile(path.join(directory, lastName), 'changed');
  await assert.rejects(verifyArchives(directory, '0.2.0'), /Checksum mismatch/);
  await writeFile(path.join(directory, lastName), lastName);
  await writeFile(path.join(directory, 'SHA256SUMS'), entries.slice(0, 5).join(''));
  await assert.rejects(verifyArchives(directory, '0.2.0'), /exactly one checksum/);
});

test('only the matching app PR at the verified head can request merge', () => {
  const pull = { baseRefName: 'main', headRefName: 'release/unswell-v0.2.0', headRefOid: 'abc',
    author: { login: 'app/ptah-publish', is_bot: true }, isCrossRepository: false };
  const validate = (value) => validatePull(value, pull.headRefName, pull.author.login, 'abc');
  validate(pull);
  for (const change of [{ baseRefName: 'other' }, { headRefName: 'other' }, { headRefOid: 'changed' },
    { author: { login: 'someone' } }, { isCrossRepository: true }]) {
    assert.throws(() => validate({ ...pull, ...change }));
  }
});
