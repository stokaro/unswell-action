import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function diagnosticFixtures(directory) {
  await mkdir(directory, { recursive: true });
  for (const severity of ['warning', 'error', 'note']) {
    await writeFile(path.join(directory, `${severity} case.go`),
      'package fixture\r\n\r\n// It is important to note that the client retries.\r\nfunc Example() {}\r\n');
    const gate = severity === 'error' ? 'forbid' : 'none';
    await writeFile(path.join(directory, `${severity}.yaml`), `version: 1\nextends: [builtin:custom]\nrules:\n` +
      `  filler.announced-importance: {enabled: true, severity: ${severity}, gate: ${gate}, score: {weight: 0, cap: 0}}\n`);
  }
  await writeFile(path.join(directory, 'warning-forbid.yaml'), 'version: 1\nextends: [builtin:custom]\nrules:\n' +
    '  filler.announced-importance: {enabled: true, severity: warning, gate: forbid}\n');
  await writeFile(path.join(directory, 'negative.go'),
    '// Package document defines source coordinates and the neutral prose model.\npackage fixture\n\n' +
    '// Emit latches validation failures even when a custom rule ignores the error.\nfunc Emit() {}\n');
  await writeFile(path.join(directory, 'negative.yaml'), 'version: 1\nextends: [builtin:custom]\nrules:\n' +
    '  syntax.noun-stack: {enabled: true, gate: forbid}\n');
  await writeFile(path.join(directory, 'injection.md'), 'The client opens connections.\n');
  await writeFile(path.join(directory, 'injection.yaml'), `version: 1
extends: [builtin:custom]
rules:
  fixture.injection: {enabled: true}
rule_sets:
  - version: 1
    namespace: fixture
    release: "1"
    license: MIT
    provenance: An action regression fixture with source-controlled diagnostic text.
    rules:
      - id: fixture.injection
        version: 1
        summary: Test workflow command isolation.
        message: "::error::UNSWELL_SOURCE_INJECTION"
        severity: warning
        gate: none
        scope: sentence
        requires: [tokens, sentences]
        contexts: [paragraph]
        match: {type: phrase, at: start, values: ["The client"]}
        examples:
          fail: ["The client opens connections."]
          pass: ["Connections are open."]
`);
  await writeFile(path.join(directory, 'control.go'), 'package fixture\n');
}
