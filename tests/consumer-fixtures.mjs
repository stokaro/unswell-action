import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('artifacts/consumer', { recursive: true });
await writeFile('artifacts/consumer/policy.yaml', 'version: 1\nextends: [builtin:strict-v1]\n');
await writeFile('artifacts/consumer/bad.md', 'Certainly! The client opens connections.\n');
await writeFile('artifacts/consumer/invalid.cs', 'class Sample { string value = "unfinished');
