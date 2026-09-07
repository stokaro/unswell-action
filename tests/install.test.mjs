import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { expectedChecksum, install, releaseAsset, releaseVersion } from '../src/install.mjs';

test('release selection supports exact versions and all six archives', () => {
  assert.equal(releaseVersion('v0.1.0-alpha.1'), '0.1.0-alpha.1');
  for (const platform of ['linux', 'darwin', 'win32']) {
    for (const architecture of ['x64', 'arm64']) {
      assert.match(releaseAsset('0.1.0-alpha.1', platform, architecture).name, /^unswell_0\.1\.0-alpha\.1_/);
    }
  }
  for (const value of ['latest', 'main', '../1.2.3', '1.2.3\n', '1.2.3; echo changed']) {
    assert.throws(() => releaseVersion(value));
  }
  assert.throws(() => releaseAsset('1.2.3', 'linux', 'riscv64'), /Unsupported runner/);
});

test('missing, repeated and malformed checksums fail', () => {
  const digest = 'a'.repeat(64);
  const line = `${digest}  ./archive.tar.gz\n`;
  assert.equal(expectedChecksum(line, 'archive.tar.gz'), digest);
  assert.equal(expectedChecksum(line.replace('\n', '\r\n'), 'archive.tar.gz'), digest);
  assert.throws(() => expectedChecksum(line, 'missing.tar.gz'));
  assert.throws(() => expectedChecksum(line + line, 'archive.tar.gz'));
  assert.throws(() => expectedChecksum('invalid checksum', 'archive.tar.gz'));
});

test('tampered downloads cannot be extracted or installed', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'unswell-download-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const asset = releaseAsset('0.1.0-alpha.1');
  const digest = createHash('sha256').update('original').digest('hex');
  const fetcher = async (url) => new Response(url.endsWith('/SHA256SUMS') ? `${digest}  ./${asset.name}\n` : 'changed');
  await assert.rejects(install('0.1.0-alpha.1', directory, { fetcher }), /checksum mismatch/);
  assert.deepEqual(await readdir(directory), []);
});

test('missing releases and oversized metadata fail before installation', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'unswell-download-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(install('0.1.0-alpha.1', directory, {
    fetcher: async () => new Response('missing', { status: 404 }),
  }), /HTTP 404/);
  await assert.rejects(install('0.1.0-alpha.1', directory, {
    fetcher: async () => new Response('data', { headers: { 'content-length': '2000000' } }),
  }), /size limit/);
  assert.deepEqual(await readdir(directory), []);
});
