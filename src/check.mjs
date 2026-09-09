import { spawn } from 'node:child_process';
import { mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { forwardDiagnostics } from './diagnostics.mjs';

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
  const child = spawn(binary, args, { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] });
  const status = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (signal) reject(new Error(`Unswell was terminated by ${signal}.`));
      else resolve(code ?? 2);
    });
  });
  const operations = [status,
    forwardDiagnostics(child.stdout, process.stdout, directory),
    forwardDiagnostics(child.stderr, process.stderr, directory)];
  try {
    const [code] = await Promise.all(operations);
    return { code, reports };
  } catch (error) {
    child.kill();
    await Promise.allSettled(operations);
    throw error;
  }
}
