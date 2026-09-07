import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { argumentsFor, check } from '../src/check.mjs';
import { install, releaseAsset } from '../src/install.mjs';

const execute = promisify(execFile);

test('path and config inputs are passed as individual arguments', () => {
  const args = argumentsFor({ paths: 'a file.md\n--config\n', config: 'policy file.yaml' }, { json: 'a.json', sarif: 'a.sarif' });
  assert.deepEqual(args.slice(-5), ['--config', 'policy file.yaml', '--', 'a file.md', '--config']);
  assert.throws(() => argumentsFor({ paths: '\n' }, {}), /at least one/);
});

test('real release-shaped archive installs and preserves CLI outcomes', async (t) => {
  assert.ok(process.env.UNSWELL_TEST_BINARY, 'Set UNSWELL_TEST_BINARY to a built Unswell CLI for integration tests.');
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'unswell-action-test-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const binary = await installFixture(temporary);
  const workspace = path.join(temporary, 'workspace with spaces');
  await mkdir(workspace);
  await writeFile(path.join(workspace, 'policy.yaml'), 'version: 1\nextends: [builtin:strict-v1]\n');
  const cases = [
    { name: 'clean.md', text: 'The client opens connections.\n', code: 0 },
    { name: 'bad.md', text: 'Certainly! The client opens connections.\n', code: 1 },
    { name: 'broken.cs', text: 'class Sample { string value = "unfinished', code: 2 },
    { name: 'config.yaml', text: 'message: Certainly! The client opens connections.\n', code: 1 },
  ];
  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      await writeFile(path.join(workspace, fixture.name), fixture.text);
      const result = await check(binary, { paths: fixture.name, config: 'policy.yaml' }, workspace, path.join(temporary, fixture.name));
      assert.equal(result.code, fixture.code);
      const json = JSON.parse(await readFile(result.reports.json, 'utf8'));
      assert.equal(json.gate.passed, fixture.code === 0);
      const sarif = JSON.parse(await readFile(result.reports.sarif, 'utf8'));
      assert.equal(sarif.version, '2.1.0');
      assert.equal(sarif.runs[0].invocations[0].executionSuccessful, fixture.code !== 2);
    });
  }
  await writeFile(path.join(workspace, 'policy.yaml'),
    'version: 1\nextends: [builtin:strict-v1]\nextraction:\n  contexts: [comment]\n  languages:\n    yaml:\n      contexts: [string]\n');
  const overridden = await check(binary, { paths: 'config.yaml', config: 'policy.yaml' }, workspace, path.join(temporary, 'override'));
  assert.equal(overridden.code, 1);
  await assert.rejects(check(binary, { directory: '..' }, workspace, path.join(temporary, 'outside')), /inside/);
  const missing = await check(binary, { paths: 'clean.md', config: 'missing.yaml' }, workspace, path.join(temporary, 'missing'));
  assert.equal(missing.code, 2);
});

async function installFixture(temporary) {
  const asset = releaseAsset('0.1.0-alpha.1');
  const source = path.join(temporary, 'archive');
  const entry = path.join(source, asset.entry);
  await mkdir(path.dirname(entry), { recursive: true });
  await copyFile(process.env.UNSWELL_TEST_BINARY, entry);
  await chmod(entry, 0o755);
  const archivePath = path.join(temporary, asset.name);
  if (process.platform === 'win32') {
    await execute('tar', ['-a', '-cf', archivePath, '-C', source, asset.entry]);
  } else {
    await execute('tar', ['-czf', archivePath, '-C', source, asset.entry]);
  }
  const bytes = await readFile(archivePath);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const visited = [];
  const fetcher = async (url) => {
    visited.push(url);
    if (url.endsWith('/SHA256SUMS')) return new Response(`${digest}  ./${asset.name}\n`);
    assert.ok(url.endsWith(`/${asset.name}`));
    return new Response(bytes);
  };
  const installed = await install('v0.1.0-alpha.1', path.join(temporary, 'installed with spaces'), { fetcher });
  assert.equal(visited.length, 2);
  assert.deepEqual(await readFile(installed.binary), await readFile(process.env.UNSWELL_TEST_BINARY));
  return installed.binary;
}
