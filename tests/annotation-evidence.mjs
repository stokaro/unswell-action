import assert from 'node:assert/strict';
import { verifyAnnotations } from './annotations.mjs';

const platforms = { 'ubuntu-latest': 'linux', 'macos-latest': 'darwin', 'windows-latest': 'win32' };

export async function collectAnnotationEvidence(context, artifacts, get, readArtifact) {
  const { repository, runID, runAttempt, actionCommit, cliCommit } = context;
  assert.match(repository, /^[\w.-]+\/[\w.-]+$/);
  assert.match(runID, /^[1-9]\d*$/);
  assert.ok(Number.isSafeInteger(runAttempt) && runAttempt > 0);
  for (const commit of [actionCommit, cliCommit]) assert.match(commit, /^[a-f0-9]{40}$/);
  const root = `https://api.github.com/repos/${repository}`;
  const runURL = `${root}/actions/runs/${runID}`;
  const run = await get(`${runURL}/attempts/${runAttempt}`);
  assert.equal(String(run.id), runID);
  assert.equal(run.run_attempt, runAttempt);
  assert.match(run.head_sha, /^[a-f0-9]{40}$/);

  async function pages(url, key) {
    const values = [];
    for (let page = 1; page <= 100; page++) {
      const response = await get(`${url}?per_page=100&page=${page}`);
      const batch = key ? response[key] : response;
      assert.ok(Array.isArray(batch));
      values.push(...batch);
      if (batch.length < 100) return values;
    }
    throw new Error('GitHub evidence exceeds the pagination limit');
  }
  const attempts = new Map();
  async function jobs(attempt) {
    if (!attempts.has(attempt)) attempts.set(attempt, await pages(`${runURL}/attempts/${attempt}/jobs`, 'jobs'));
    return attempts.get(attempt);
  }
  function selectJob(values, os, attempt) {
    const matches = values.filter((job) => job.name === `Test (${os})`);
    assert.equal(matches.length, 1, `Expected one ${os} job in attempt ${attempt}`);
    const job = matches[0];
    assert.equal(String(job.run_id), runID);
    assert.equal(job.run_attempt, attempt);
    assert.equal(job.head_sha, run.head_sha);
    assert.equal(job.status, 'completed');
    assert.equal(job.conclusion, 'success');
    assert.ok(Number.isSafeInteger(job.id) && job.id > 0);
    assert.ok(Number.isSafeInteger(job.runner_id) && job.runner_id > 0);
    assert.ok(typeof job.runner_name === 'string' && job.runner_name.length > 0);
    assert.ok(Number.isFinite(Date.parse(job.started_at)));
    assert.ok(Date.parse(job.completed_at) >= Date.parse(job.started_at));
    return job;
  }

  const candidates = new Map();
  for (const name of artifacts) {
    const match = /^action-evidence-(ubuntu-latest|macos-latest|windows-latest)-attempt-([1-9]\d*)$/.exec(name);
    assert.ok(match, `Invalid evidence artifact name: ${name}`);
    const [, os, attemptText] = match;
    const attempt = Number(attemptText);
    assert.ok(Number.isSafeInteger(attempt) && attempt <= runAttempt);
    const key = `${os}/${attempt}`;
    assert.ok(!candidates.has(key), `Duplicate evidence for ${key}`);
    candidates.set(key, { name, os, attempt });
  }

  const currentJobs = await jobs(runAttempt);
  const evidence = [];
  for (const os of Object.keys(platforms)) {
    const latest = selectJob(currentJobs, os, runAttempt);
    const choices = [...candidates.values()].filter((artifact) => artifact.os === os);
    choices.sort((a, b) => b.attempt - a.attempt);
    assert.ok(choices.length, `Missing ${os} evidence`);
    const artifact = choices[0];
    const expected = await readArtifact(artifact.name);
    assert.equal(expected.repository, repository);
    assert.equal(expected.run_id, runID);
    assert.equal(expected.run_attempt, artifact.attempt);
    assert.equal(expected.action_commit, actionCommit);
    assert.equal(expected.cli_commit, cliCommit);
    assert.equal(expected.platform, platforms[os]);
    const job = selectJob(await jobs(expected.run_attempt), os, expected.run_attempt);
    assert.equal(job.runner_name, expected.runner_name);
    assert.ok(Date.parse(job.created_at) <= Date.parse(job.started_at), 'Evidence must belong to an executed job');
    // A carried success has a new job ID but retains the original execution times and runner.
    for (const key of ['started_at', 'completed_at', 'runner_id', 'runner_name']) {
      assert.equal(job[key], latest[key], `Stale ${os} evidence: ${key} changed`);
    }
    assert.ok(job.check_run_url.startsWith(`${root}/check-runs/`));
    assert.match(job.check_run_url.slice(`${root}/check-runs/`.length), /^[1-9]\d*$/);
    const annotations = await pages(`${job.check_run_url}/annotations`);
    verifyAnnotations(expected.expected, annotations);
    evidence.push({ ...expected, os, job: job.id, observed_job: latest.id,
      collector_attempt: runAttempt, workflow_head: run.head_sha, artifact: artifact.name, annotations });
  }
  return evidence;
}
