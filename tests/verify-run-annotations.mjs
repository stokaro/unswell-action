import assert from 'node:assert/strict';
import { collectAnnotationEvidence } from './annotation-evidence.mjs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';

async function get(url) {
  const response = await fetch(url, { headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
  assert.equal(response.status, 200, `GitHub API status for ${url}`);
  return response.json();
}

const artifacts = await readdir('artifacts/downloaded');
const evidence = await collectAnnotationEvidence({ repository: process.env.GITHUB_REPOSITORY,
  runID: process.env.GITHUB_RUN_ID, runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
  actionCommit: process.env.GITHUB_SHA, cliCommit: process.env.UNSWELL_CLI_COMMIT }, artifacts, get,
  async (name) => JSON.parse(await readFile(`artifacts/downloaded/${name}/diagnostic-evidence/expected.json`, 'utf8')));
await mkdir('artifacts/annotation-verification', { recursive: true });
await writeFile('artifacts/annotation-verification/verified.json', JSON.stringify(evidence, null, 2));
console.log('Verified actual warning, error, notice, location, command isolation, and matcher cleanup on all three runners.');
