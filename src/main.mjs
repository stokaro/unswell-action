import { randomUUID } from 'node:crypto';
import { access, appendFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { check } from './check.mjs';
import { install } from './install.mjs';
import { defaultVersion } from './default-version.mjs';
import { reportFailure, withDiagnostics } from './diagnostics.mjs';

async function output(name, value) {
  const delimiter = randomUUID();
  await appendFile(process.env.GITHUB_OUTPUT, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

async function reportOutput(name, filename) {
  try {
    await access(filename);
  } catch {
    return;
  }
  await output(name, filename);
}

async function main() {
  const temporary = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'unswell-'));
  try {
    const installed = await install(process.env.INPUT_VERSION || defaultVersion, path.join(temporary, 'install'));
    await output('version', installed.version);
    const inputs = {
      paths: process.env.INPUT_PATHS ?? '.',
      config: process.env.INPUT_CONFIG ?? '',
      directory: process.env['INPUT_WORKING-DIRECTORY'] ?? '.',
    };
    const result = await withDiagnostics(temporary, () =>
      check(installed.binary, inputs, process.env.GITHUB_WORKSPACE, path.join(temporary, 'reports')));
    await output('exit-code', result.code);
    await reportOutput('report-json', result.reports.json);
    await reportOutput('report-sarif', result.reports.sarif);
    process.exitCode = result.code;
  } finally {
    await rm(path.join(temporary, 'install'), { recursive: true, force: true });
  }
}

main().catch(async (error) => {
  await reportFailure(error.message);
  process.exitCode = 2;
  if (process.env.GITHUB_OUTPUT) await output('exit-code', 2);
});
