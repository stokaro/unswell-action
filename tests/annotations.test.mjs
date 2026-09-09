import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyAnnotations } from './annotations.mjs';

function fixture() {
  const expected = ['warning', 'notice', 'failure'].map((level) => ({
    path: `artifacts/diagnostic consumer/${level}.go`, start_line: 3, start_column: 4,
    annotation_level: level, message: 'Review the wording.',
  }));
  const actual = [...expected.map((value) => ({ ...value })),
    { message: 'consumer matcher survived', annotation_level: 'notice' },
    { path: 'artifacts/diagnostic consumer/control.go', message: 'action matcher removed', annotation_level: 'failure' }];
  return { expected, actual };
}

test('annotation evidence rejects severity, location, injection, and cleanup regressions', () => {
  const clean = fixture();
  verifyAnnotations(clean.expected, clean.actual);
  const cases = [
    (a) => { a[0].annotation_level = 'failure'; },
    (a) => { a[0].start_line++; },
    (a) => { a[0].start_column++; },
    (a) => { a[0].path = 'wrong.go'; },
    (a) => { a.pop(); },
    (a) => { a.splice(3, 1); },
    (a) => { a.push({ message: 'UNSWELL_SOURCE_INJECTION', annotation_level: 'failure' }); },
    (a) => { a.push({ ...a[0] }); },
  ];
  for (const change of cases) {
    const { expected, actual } = fixture();
    change(actual);
    assert.throws(() => verifyAnnotations(expected, actual));
  }
});
