import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

assert.equal(process.env.PASS_CODE, '0');
assert.equal(process.env.BAD_OUTCOME, 'failure');
assert.equal(process.env.BAD_CODE, '1');
assert.equal(process.env.ERROR_OUTCOME, 'failure');
assert.equal(process.env.ERROR_CODE, '2');
const bad = JSON.parse(await readFile(process.env.BAD_JSON, 'utf8'));
assert.equal(bad.status, 'complete');
assert.equal(bad.gate.passed, false);
assert.ok(bad.findings.length > 0);
const sarif = JSON.parse(await readFile(process.env.BAD_SARIF, 'utf8'));
assert.equal(sarif.version, '2.1.0');
assert.equal(sarif.runs[0].invocations[0].executionSuccessful, true);
const error = JSON.parse(await readFile(process.env.ERROR_JSON, 'utf8'));
assert.equal(error.gate.passed, false);
assert.ok(error.errors.length > 0);
console.log('The published action preserved pass, policy-failure and operational-error outcomes.');
