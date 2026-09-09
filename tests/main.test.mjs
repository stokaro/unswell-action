import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { diagnosticFixtures } from './diagnostic-fixtures.mjs';
import { releaseFixture } from './release-fixture.mjs';

const execute = promisify(execFile);
const action = fileURLToPath(new URL('../src/main.mjs', import.meta.url));
const hook = new URL('./fetch-fixture.mjs', import.meta.url).href;

function outputs(text) {
  const result = {};
  const lines = text.trimEnd().split('\n');
  for (let i = 0; i < lines.length;) {
    const [key, delimiter] = lines[i++].split('<<');
    const values = [];
    while (i < lines.length && lines[i] !== delimiter) values.push(lines[i++]);
    assert.equal(lines[i++], delimiter);
    result[key] = values.join('\n');
  }
  return result;
}

test('real action entry point preserves levels, reports, cleanup, and exit codes', async (t) => {
  assert.ok(process.env.UNSWELL_TEST_BINARY);
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'unswell-main-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const fixture = await releaseFixture(process.env.UNSWELL_TEST_BINARY, path.join(temporary, 'release'));
  const directory = path.join(temporary, 'project with spaces');
  await diagnosticFixtures(directory);
  const cases = [
    ['warning', 'warning case.go', 0, 1], ['error', 'error case.go', 1, 1], ['note', 'note case.go', 0, 1],
    ['warning-forbid', 'warning case.go', 1, 1], ['negative', 'negative.go', 0, 0], ['injection', 'injection.md', 0, 1],
    ['missing', 'negative.go', 2, null],
  ];
  for (const [name, source, code, count] of cases) {
    await t.test(name, async () => {
      const output = path.join(temporary, `${name}.outputs`);
      await writeFile(output, '');
      const env = { ...process.env, UNSWELL_RELEASE_FIXTURE: fixture, GITHUB_OUTPUT: output,
        GITHUB_WORKSPACE: temporary, RUNNER_TEMP: temporary, INPUT_VERSION: '0.0.0-test', INPUT_PATHS: source,
        INPUT_CONFIG: `${name}.yaml`, 'INPUT_WORKING-DIRECTORY': 'project with spaces' };
      let result;
      try { result = await execute(process.execPath, ['--import', hook, action], { env }); }
      catch (error) { result = error; }
      assert.equal(result.code ?? 0, code, result.stderr);
      const values = outputs(await readFile(output, 'utf8'));
      assert.equal(values['exit-code'], String(code));
      const log = result.stdout;
      assert.match(log, /::add-matcher::[^\n]+\n::stop-commands::/);
      assert.equal((log.match(/::remove-matcher owner=/g) ?? []).length, 2);
      if (count !== null) {
        const json = JSON.parse(await readFile(values['report-json'], 'utf8'));
        assert.equal(json.findings.length, count);
        if (count) assert.match(log, new RegExp(path.resolve(directory).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        assert.equal(JSON.parse(await readFile(values['report-sarif'], 'utf8')).version, '2.1.0');
        const names = await readdir(path.dirname(path.dirname(values['report-json'])));
        assert.deepEqual(names, ['reports']);
      }
      if (name === 'injection') assert.match(log, /::error::UNSWELL_SOURCE_INJECTION/);
    });
  }
});
