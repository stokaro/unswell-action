import assert from 'node:assert/strict';

export function verifyAnnotations(expected, annotations) {
  const remaining = [...annotations];
  for (const wanted of expected) {
    const found = remaining.findIndex((actual) => actual.path === wanted.path && actual.start_line === wanted.start_line &&
      actual.start_column === wanted.start_column && actual.annotation_level === wanted.annotation_level &&
      actual.message.includes(wanted.message));
    assert.notEqual(found, -1, JSON.stringify({ wanted, annotations }));
    remaining.splice(found, 1);
  }
  assert.ok(annotations.some((item) => item.message === 'consumer matcher survived' && item.annotation_level === 'notice'));
  assert.ok(annotations.some((item) => item.path === 'artifacts/diagnostic consumer/control.go' &&
    item.message.includes('action matcher removed') && item.annotation_level === 'failure'));
  assert.ok(!remaining.some((item) => item.path?.startsWith('artifacts/diagnostic consumer/') && !item.path.endsWith('/control.go')),
    JSON.stringify({ unexpected: remaining }));
  assert.ok(!annotations.some((item) => item.message === 'UNSWELL_SOURCE_INJECTION' && item.annotation_level === 'failure'));
}
