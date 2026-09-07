import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const releaseRoot = 'https://github.com/stokaro/unswell/releases/download';

export function releaseVersion(value) {
  const version = value.replace(/^v/, '');
  if (version.length > 80 || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/.test(version)) {
    throw new Error('Set version to an exact release, such as 0.1.0-alpha.1.');
  }
  return version;
}

export function releaseAsset(version, platform = process.platform, architecture = process.arch) {
  const os = { linux: 'linux', darwin: 'darwin', win32: 'windows' }[platform];
  const arch = { x64: 'amd64', arm64: 'arm64' }[architecture];
  if (!os || !arch) throw new Error(`Unsupported runner: ${platform}/${architecture}`);
  const base = `unswell_${releaseVersion(version)}_${os}_${arch}`;
  return { name: base + (os === 'windows' ? '.zip' : '.tar.gz'), entry: `${base}/unswell${os === 'windows' ? '.exe' : ''}` };
}

export function expectedChecksum(manifest, name) {
  const matches = [];
  for (const line of manifest.trimEnd().split('\n')) {
    const match = /^([a-f0-9]{64})  (?:\.\/)?([^/\\\r\n]+)\r?$/.exec(line);
    if (!match) throw new Error('The release checksum manifest is malformed.');
    if (match[2] === name) matches.push(match[1]);
  }
  if (matches.length !== 1) throw new Error(`Expected exactly one checksum for ${name}.`);
  return matches[0];
}

async function download(url, limit, fetcher) {
  const response = await fetcher(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body) throw new Error(`Release download failed: HTTP ${response.status}`);
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body.cancel();
    throw new Error('Release download exceeds its size limit.');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error('Release download exceeds its size limit.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}

export async function install(value, directory, options = {}) {
  const version = releaseVersion(value);
  const asset = releaseAsset(version, options.platform, options.architecture);
  const fetcher = options.fetcher ?? globalThis.fetch;
  const manifest = await download(`${releaseRoot}/v${version}/SHA256SUMS`, 1024 * 1024, fetcher);
  const expected = expectedChecksum(manifest.toString('utf8'), asset.name);
  const archive = await download(`${releaseRoot}/v${version}/${asset.name}`, 256 * 1024 * 1024, fetcher);
  if (createHash('sha256').update(archive).digest('hex') !== expected) {
    throw new Error('Release archive checksum mismatch.');
  }
  await mkdir(directory, { recursive: true });
  const archivePath = path.join(directory, asset.name);
  await writeFile(archivePath, archive, { flag: 'wx' });
  try {
    await execute('tar', ['-xf', archivePath, '-C', directory, '--strip-components=1', asset.entry], { timeout: 60_000 });
  } finally {
    await rm(archivePath, { force: true });
  }
  const binary = path.join(directory, path.posix.basename(asset.entry));
  const stat = await lstat(binary);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('The release executable is not a regular file.');
  await chmod(binary, 0o755);
  return { binary, version };
}
