import { randomUUID } from 'node:crypto';
import { lstat, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

const diagnostic = /^(.+?):([0-9]+):([0-9]+): (error|warning|note) \[([^\]]+)\] (.+)$/;

export async function sourceRoot(directory) {
  // CLI paths are relative to the nearest .git marker, or cwd outside a checkout.
  for (let current = directory;; current = path.dirname(current)) {
    try {
      await lstat(path.join(current, '.git'));
      return current;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (current === path.dirname(current)) return directory;
  }
}

export function matchers(owner) {
  return { problemMatcher: [
    { owner, pattern: [{
      regexp: '^(.+?):([0-9]+):([0-9]+): (error|warning) \\[([^\\]]+)\\] (.+)$',
      file: 1, line: 2, column: 3, severity: 4, code: 5, message: 6,
    }] },
    { owner: `${owner}-note`, severity: 'notice', pattern: [{
      regexp: '^(.+?):([0-9]+):([0-9]+): note \\[([^\\]]+)\\] (.+)$',
      file: 1, line: 2, column: 3, code: 4, message: 5,
    }] },
  ] };
}

export function diagnosticLine(line, directory) {
  const ending = line.endsWith('\r') ? '\r' : '';
  const value = ending ? line.slice(0, -1) : line;
  const match = diagnostic.exec(value);
  if (!match) return line;
  const [, filename, row, column, severity, rule, message] = match;
  return `${path.resolve(directory, filename)}:${row}:${column}: ${severity} [${rule}] ${message}${ending}`;
}

export function write(stream, value) {
  return new Promise((resolve, reject) => stream.write(value, (error) => error ? reject(error) : resolve()));
}

function commandData(value) {
  return value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

export async function reportFailure(message, output = process.stdout) {
  await write(output, `::error::Unswell action failed: ${commandData(message)}\n`);
}

export async function withDiagnostics(directory, run, output = process.stdout) {
  const owner = `unswell-action-${randomUUID()}`;
  const stopToken = randomUUID();
  const filename = path.join(directory, 'problem-matchers.json');
  await writeFile(filename, JSON.stringify(matchers(owner)), { flag: 'wx' });
  try {
    await write(output, `::add-matcher::${commandData(filename)}\n`);
    // Matchers still run while source-controlled workflow commands are disabled.
    await write(output, `::stop-commands::${stopToken}\n`);
    try {
      return await run();
    } finally {
      await write(output, `::${stopToken}::\n`);
      for (const name of [owner, `${owner}-note`]) {
        await write(output, `::remove-matcher owner=${name}::\n`);
      }
    }
  } finally {
    await rm(filename, { force: true });
  }
}

export async function forwardDiagnostics(input, output, directory) {
  input.setEncoding('utf8');
  let pending = '';
  for await (const chunk of input) {
    pending += chunk;
    let end;
    while ((end = pending.indexOf('\n')) !== -1) {
      if (end > 8 * 1024 * 1024) throw new Error('Unswell output line exceeds the buffer limit.');
      await write(output, `${diagnosticLine(pending.slice(0, end), directory)}\n`);
      pending = pending.slice(end + 1);
    }
    // Bound a malformed executable's unterminated output without truncating it.
    if (pending.length > 8 * 1024 * 1024) throw new Error('Unswell output line exceeds the buffer limit.');
  }
  if (pending) await write(output, `${diagnosticLine(pending, directory)}\n`);
}
