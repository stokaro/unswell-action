import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { declaredInputs, inputDifferences, readInputs } from '../src/manifest.mjs';

const manifest = await readFile(new URL('../action.yml', import.meta.url), 'utf8');
const main = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');

test('the manifest declares every input that the action reads, and no other', () => {
  assert.deepEqual(declaredInputs(manifest), ['version', 'paths', 'config', 'working-directory', 'timeout', 'jobs']);
  assert.deepEqual(inputDifferences(manifest, main), { undeclared: [], unread: [] });
});

test('a manifest that lost an input is found', () => {
  const lost = manifest.replace(/^ {2}timeout:\r?\n(?: {4}.*\r?\n)+/m, '');
  assert.notEqual(lost, manifest);
  assert.deepEqual(inputDifferences(lost, main), { undeclared: ['timeout'], unread: [] });
});

test('an input that the action does not read is found', () => {
  const extra = manifest.replace(/^outputs:/m, "  retries:\n    description: Not read.\n    required: false\n    default: ''\noutputs:");
  assert.deepEqual(inputDifferences(extra, main), { undeclared: [], unread: ['retries'] });
});

test('inputs are read from both spellings of the environment', () => {
  assert.deepEqual(readInputs("process.env.INPUT_PATHS ?? process.env['INPUT_WORKING-DIRECTORY']; process.env.GITHUB_OUTPUT"),
    ['paths', 'working-directory']);
  // An output or a name deeper in the manifest is no input.
  assert.deepEqual(declaredInputs("inputs:\n  version:\n    default: 'x'\noutputs:\n  exit-code:\n    description: d\n"), ['version']);
});
