import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { releaseAsset } from '../src/install.mjs';

export async function releaseFixture(binary, directory) {
  const version = '0.0.0-test';
  const asset = releaseAsset(version);
  const source = path.join(directory, 'source');
  const entry = path.join(source, asset.entry);
  await mkdir(path.dirname(entry), { recursive: true });
  await copyFile(binary, entry);
  await chmod(entry, 0o755);
  const archive = path.join(directory, asset.name);
  const options = process.platform === 'win32' ? ['-a', '-cf'] : ['-czf'];
  await promisify(execFile)('tar', [...options, archive, '-C', source, asset.entry]);
  const bytes = await readFile(archive);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const manifest = path.join(directory, 'fixture.json');
  await writeFile(manifest, JSON.stringify({ version, archive, asset: asset.name, checksum: `${digest}  ${asset.name}\n` }));
  return manifest;
}
