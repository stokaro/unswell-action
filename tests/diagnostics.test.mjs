import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import test from 'node:test';
import { diagnosticLine, forwardDiagnostics, matchers, reportFailure, withDiagnostics } from '../src/diagnostics.mjs';

function capture() {
  const parts = [];
  const stream = new Writable({ write(chunk, _encoding, callback) { parts.push(chunk.toString()); callback(); } });
  return { stream, text: () => parts.join('') };
}

test('ECMAScript matchers preserve warning, error, and note fields', () => {
  const patterns = matchers('fixture').problemMatcher;
  for (const severity of ['warning', 'error', 'note']) {
    const item = patterns.find((item) => new RegExp(item.pattern[0].regexp).test(`a file.go:3:4: ${severity} [filler.test] Explain.`));
    assert.ok(item);
    const pattern = item.pattern[0];
    const match = new RegExp(pattern.regexp).exec(`a file.go:3:4: ${severity} [filler.test] Explain.`);
    assert.equal(match[pattern.file], 'a file.go');
    assert.equal(match[pattern.line], '3');
    assert.equal(match[pattern.column], '4');
    assert.equal(match[pattern.code], 'filler.test');
    assert.equal(match[pattern.message], 'Explain.');
    assert.equal(pattern.severity ? match[pattern.severity] : item.severity, severity === 'note' ? 'notice' : severity);
  }
  for (const text of ['PASS: 1 documents', 'a.go:1:1: warning [missing Explanation.', '  related: a.go:1:2']) {
    assert.ok(patterns.every((item) => !new RegExp(item.pattern[0].regexp).test(text)));
  }
});

test('diagnostic paths use the CLI working directory, preserving CRLF and other text', () => {
  const directory = path.resolve('project with spaces');
  assert.equal(diagnosticLine('a file.go:3:4: warning [filler.test] Explain.\r', directory),
    `${path.join(directory, 'a file.go')}:3:4: warning [filler.test] Explain.\r`);
  assert.equal(diagnosticLine('  source ::error::literal', directory), '  source ::error::literal');
});

test('streaming waits for writes and preserves split UTF-8, CRLF, and final lines', async () => {
  const directory = path.resolve('a project');
  const text = 'a file.go:3:4: warning [filler.test] é😀\r\n  ::error::literal\nlast';
  const bytes = Buffer.from(text);
  const output = capture();
  await forwardDiagnostics(Readable.from(Array.from(bytes, (byte) => Buffer.from([byte]))), output.stream, directory);
  assert.equal(output.text(), `${path.join(directory, 'a file.go')}:3:4: warning [filler.test] é😀\r\n  ::error::literal\nlast\n`);
  const broken = new Writable({ write(_chunk, _encoding, callback) { callback(new Error('writer failed')); } });
  broken.on('error', () => {});
  await assert.rejects(forwardDiagnostics(Readable.from(['line\n']), broken, directory), /writer failed/);
});

test('matcher lifetime brackets source output and removes only unique owners on failure', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'unswell-matchers-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const owners = new Set();
  for (const fail of [false, true]) {
    const output = capture();
    const run = () => withDiagnostics(directory, async () => {
      const config = JSON.parse(await readFile(path.join(directory, 'problem-matchers.json'), 'utf8'));
      for (const matcher of config.problemMatcher) {
        assert.match(matcher.owner, /^unswell-action-/);
        assert.ok(!owners.has(matcher.owner));
        owners.add(matcher.owner);
      }
      assert.match(output.text(), /::add-matcher::[^\n]+\n::stop-commands::[^\n]+\n$/);
      if (fail) throw new Error('command failed');
      return 7;
    }, output.stream);
    if (fail) await assert.rejects(run(), /command failed/);
    else assert.equal(await run(), 7);
    const lines = output.text().trimEnd().split('\n');
    const token = lines[1].slice('::stop-commands::'.length);
    assert.equal(lines[2], `::${token}::`);
    assert.equal(lines.length, 5);
    assert.ok(lines.slice(3).every((line) => /^::remove-matcher owner=unswell-action-[a-f0-9-]+(?:-note)?::$/.test(line)));
    assert.deepEqual(await readdir(directory), []);
  }
});

test('operational error messages cannot add workflow commands', async () => {
  const output = capture();
  await reportFailure('bad%value\r\n::warning::injected', output.stream);
  assert.equal(output.text(), '::error::Unswell action failed: bad%25value%0D%0A::warning::injected\n');
});

test('unterminated and complete oversized lines fail instead of growing without a bound', async () => {
  for (const ending of ['', '\n']) {
    const output = capture();
    await assert.rejects(forwardDiagnostics(Readable.from(['a'.repeat(8 * 1024 * 1024 + 1) + ending]),
      output.stream, process.cwd()), /buffer limit/);
    assert.equal(output.text(), '');
  }
});

test('diagnostic-looking message text cannot replace the real location or severity', () => {
  const directory = path.resolve('project');
  const source = 'real.go:3:4: warning [real.rule] example.go:8:9: error [other.rule] quoted text';
  const line = diagnosticLine(source, directory);
  const pattern = matchers('fixture').problemMatcher[0].pattern[0];
  const match = new RegExp(pattern.regexp).exec(line);
  assert.equal(match[pattern.file], path.join(directory, 'real.go'));
  assert.equal(match[pattern.severity], 'warning');
  assert.equal(match[pattern.message], 'example.go:8:9: error [other.rule] quoted text');
});
