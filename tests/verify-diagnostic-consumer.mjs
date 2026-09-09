import assert from 'node:assert/strict';
import { copyFile, readFile, writeFile } from 'node:fs/promises';

const steps = JSON.parse(process.env.CONSUMER_STEPS);
const expected = [];
const outcomes = {};
for (const [id, code, count] of [
  ['warning', 0, 1], ['note', 0, 1], ['error', 1, 1], ['forbid', 1, 1], ['negative', 0, 0], ['injection', 0, 1],
]) {
  const step = steps[`diag_${id}`];
  assert.equal(step.outcome, code === 0 ? 'success' : 'failure');
  assert.equal(step.outputs['exit-code'], String(code));
  const result = JSON.parse(await readFile(step.outputs['report-json'], 'utf8'));
  assert.equal(result.manifest.tool_commit, process.env.UNSWELL_CLI_COMMIT);
  assert.equal(result.status, 'complete');
  assert.equal(result.findings.length, count);
  assert.equal(result.gate.passed, code === 0);
  if (count) {
    const severity = { forbid: 'warning', injection: 'warning' }[id] ?? id;
    assert.equal(result.findings[0].severity, severity);
    if (id !== 'injection') {
      assert.equal(result.findings[0].primary.start.line, 3);
      assert.equal(result.findings[0].primary.start.column, 4);
    }
  }
  const sarif = JSON.parse(await readFile(step.outputs['report-sarif'], 'utf8'));
  assert.equal(sarif.version, '2.1.0');
  assert.equal(sarif.runs[0].invocations[0].executionSuccessful, true);
  for (const finding of result.findings) {
    assert.ok(finding.primary.path.startsWith('artifacts/diagnostic consumer/'));
    expected.push({ path: finding.primary.path,
      start_line: finding.primary.start.line, start_column: finding.primary.start.column,
      annotation_level: { error: 'failure', warning: 'warning', note: 'notice' }[finding.severity],
      message: finding.message, rule: finding.rule_id });
  }
  outcomes[id] = { outcome: step.outcome, code };
  for (const format of ['json', 'sarif']) {
    await copyFile(step.outputs[`report-${format}`], `artifacts/diagnostic-evidence/${id}.${format}`);
  }
}
const evidence = { action_commit: process.env.GITHUB_SHA, cli_commit: process.env.UNSWELL_CLI_COMMIT,
  platform: process.platform, outcomes, expected };
await writeFile('artifacts/diagnostic-evidence/expected.json', JSON.stringify(evidence, null, 2));
