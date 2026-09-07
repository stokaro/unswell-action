import { spawn } from 'node:child_process';
import { mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';

export function argumentsFor(inputs, reports) {
  const paths = (inputs.paths ?? '.').split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
  if (paths.length === 0) throw new Error('Set paths to at least one file or directory.');
  const args = ['check', '--report', `json:${reports.json}`, '--report', `sarif:${reports.sarif}`, '--report', 'text:-'];
  if (inputs.config) args.push('--config', inputs.config);
  args.push('--', ...paths);
  return args;
}

export async function check(binary, inputs, workspace, reportDirectory) {
  const root = await realpath(workspace);
  const directory = await realpath(path.resolve(root, inputs.directory ?? '.'));
  const relative = path.relative(root, directory);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('The working directory must be inside the checked-out workspace.');
  }
  await mkdir(reportDirectory, { recursive: true });
  const reports = { json: path.join(reportDirectory, 'unswell.json'), sarif: path.join(reportDirectory, 'unswell.sarif') };
  const args = argumentsFor(inputs, reports);
  const code = await new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd: directory, stdio: ['ignore', 'inherit', 'inherit'] });
    child.once('error', reject);
    child.once('close', (status, signal) => {
      if (signal) reject(new Error(`Unswell was terminated by ${signal}.`));
      else resolve(status ?? 2);
    });
  });
  return { code, reports };
}
