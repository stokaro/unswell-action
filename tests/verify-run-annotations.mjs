import assert from 'node:assert/strict';
import { verifyAnnotations } from './annotations.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const root = `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}`;
async function get(url) {
  const response = await fetch(url, { headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
  assert.equal(response.status, 200, `GitHub API status for ${url}`);
  return response.json();
}

const jobs = await get(`${root}/actions/runs/${process.env.GITHUB_RUN_ID}/jobs?per_page=100`);
const evidence = [];
for (const os of ['ubuntu-latest', 'macos-latest', 'windows-latest']) {
  const job = jobs.jobs.find((job) => job.name === `Test (${os})`);
  assert.ok(job, `Missing ${os} job`);
  assert.equal(job.conclusion, 'success');
  const expected = JSON.parse(await readFile(`artifacts/downloaded/action-evidence-${os}/diagnostic-evidence/expected.json`, 'utf8'));
  const annotations = await get(`${job.check_run_url}/annotations?per_page=100`);
  verifyAnnotations(expected.expected, annotations);
  evidence.push({ os, job: job.id, ...expected, annotations });
}
await mkdir('artifacts/annotation-verification', { recursive: true });
await writeFile('artifacts/annotation-verification/verified.json', JSON.stringify(evidence, null, 2));
console.log('Verified actual warning, error, notice, location, command isolation, and matcher cleanup on all three runners.');
