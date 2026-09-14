import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { collectAnnotationEvidence } from './annotation-evidence.mjs';

function fixture({ attempt = 1, rerun = [] } = {}) {
  const context = { repository: 'owner/action', runID: '42', runAttempt: attempt,
    actionCommit: 'a'.repeat(40), cliCommit: 'c'.repeat(40) };
  const head = 'b'.repeat(40); // Pull request jobs identify the head; checkout uses the merge commit.
  const root = 'https://api.github.com/repos/owner/action';
  const platforms = { 'ubuntu-latest': 'linux', 'macos-latest': 'darwin', 'windows-latest': 'win32' };
  const responses = new Map();
  const artifacts = [];
  const jobSets = {};
  const requested = [];
  const expected = ['warning', 'notice', 'failure'].map((level) => ({
    path: `artifacts/diagnostic consumer/${level}.go`, start_line: 3, start_column: 4,
    annotation_level: level, message: 'Review the wording.',
  }));
  const annotations = [...expected,
    { message: 'consumer matcher survived', annotation_level: 'notice' },
    { path: 'artifacts/diagnostic consumer/control.go', message: 'action matcher removed', annotation_level: 'failure' }];
  for (let number = 1; number <= attempt; number++) {
    const jobs = Object.entries(platforms).map(([os, platform], index) => {
      const executed = number === 1 || rerun.includes(os);
      const time = executed ? number : 1;
      const job = { id: number * 10 + index, name: `Test (${os})`, run_id: 42, run_attempt: number,
        head_sha: head, status: 'completed', conclusion: 'success', runner_id: time * 100 + index,
        runner_name: `runner-${time}-${index}`, created_at: `2026-09-14T12:${number}0:00Z`,
        started_at: `2026-09-14T12:${time}1:00Z`, completed_at: `2026-09-14T12:${time}2:00Z`,
        check_run_url: `${root}/check-runs/${number * 10 + index}` };
      responses.set(`${job.check_run_url}/annotations?per_page=100&page=1`, executed ? structuredClone(annotations) : []);
      if (executed) artifacts.push({ name: `action-evidence-${os}-attempt-${number}`, expected: {
        repository: context.repository, run_id: context.runID, run_attempt: number, platform,
        action_commit: context.actionCommit, cli_commit: context.cliCommit, runner_name: job.runner_name,
        outcomes: {}, expected: structuredClone(expected),
      } });
      return job;
    });
    jobSets[number] = jobs;
    responses.set(`${root}/actions/runs/42/attempts/${number}/jobs?per_page=100&page=1`, { jobs });
  }
  const run = { id: 42, run_attempt: attempt, head_sha: head };
  responses.set(`${root}/actions/runs/42/attempts/${attempt}`, run);
  async function get(url) {
    requested.push(url);
    assert.ok(responses.has(url), `Unexpected request: ${url}`);
    return structuredClone(responses.get(url));
  }
  return { context, artifacts, get, jobSets, responses, requested, root, run };
}

function collect(f) {
  return collectAnnotationEvidence(f.context, f.artifacts.map((a) => a.name), f.get, async (name) => {
    const artifact = f.artifacts.find((a) => a.name === name);
    assert.ok(artifact.expected, `Missing manifest: ${name}`);
    return artifact.expected;
  });
}

test('initial run binds the artifact, executed job, and actual annotations', async () => {
  const f = fixture();
  const records = await collect(f);
  assert.deepEqual(records.map((r) => [r.job, r.observed_job, r.run_attempt, r.collector_attempt]),
    [[10, 10, 1, 1], [11, 11, 1, 1], [12, 12, 1, 1]]);
  assert.ok(records.every((r) => r.annotations.length === 5 && r.workflow_head === 'b'.repeat(40)));
});

test('partial reruns use the executed attempt instead of annotation-free copied jobs', async () => {
  const f = fixture({ attempt: 3 });
  const records = await collect(f);
  assert.deepEqual(records.map((r) => [r.job, r.observed_job, r.run_attempt, r.collector_attempt]),
    [[10, 30, 1, 3], [11, 31, 1, 3], [12, 32, 1, 3]]);
  assert.ok(!f.requested.some((url) => /check-runs\/[23]\d/.test(url)));
});

test('rerunning one Test job uses new evidence only for that platform', async () => {
  const f = fixture({ attempt: 2, rerun: ['macos-latest'] });
  f.artifacts.reverse();
  const records = await collect(f);
  assert.deepEqual(records.map((r) => [r.job, r.observed_job, r.run_attempt]), [[10, 20, 1], [21, 21, 2], [12, 22, 1]]);
  assert.ok(!f.requested.some((url) => url.includes('check-runs/11/')));
});

test('a rerun cannot fall back to old evidence when its new artifact or annotations are missing', async () => {
  const missing = fixture({ attempt: 2, rerun: ['macos-latest'] });
  missing.artifacts = missing.artifacts.filter((a) => a.expected.run_attempt === 1);
  await assert.rejects(collect(missing), /Stale macos-latest evidence/);
  const empty = fixture({ attempt: 2, rerun: ['macos-latest'] });
  empty.responses.set(`${empty.root}/check-runs/21/annotations?per_page=100&page=1`, []);
  await assert.rejects(collect(empty));
  const incomplete = fixture({ attempt: 2, rerun: ['macos-latest'] });
  delete incomplete.artifacts.at(-1).expected;
  await assert.rejects(collect(incomplete), /Missing manifest/);
});

test('a completed rerun does not read an obsolete incomplete artifact', async () => {
  const f = fixture({ attempt: 2, rerun: ['macos-latest'] });
  delete f.artifacts[1].expected;
  f.jobSets[1][1].conclusion = 'failure';
  assert.equal((await collect(f))[1].job, 21);
});

test('missing, duplicate, mislabeled, foreign, and future artifacts fail closed', async (t) => {
  const mutations = {
    missing: (f) => f.artifacts.pop(),
    duplicate: (f) => f.artifacts.push(structuredClone(f.artifacts[0])),
    name: (f) => { f.artifacts[0].name = 'action-evidence-ubuntu-latest'; },
    repository: (f) => { f.artifacts[0].expected.repository = 'other/action'; },
    run: (f) => { f.artifacts[0].expected.run_id = '41'; },
    attempt: (f) => { f.artifacts[0].expected.run_attempt = 2; },
    future: (f) => { f.artifacts[0].name = 'action-evidence-ubuntu-latest-attempt-2'; f.artifacts[0].expected.run_attempt = 2; },
    commit: (f) => { f.artifacts[0].expected.action_commit = 'd'.repeat(40); },
    cli: (f) => { f.artifacts[0].expected.cli_commit = 'd'.repeat(40); },
    platform: (f) => { f.artifacts[0].expected.platform = 'darwin'; },
    runner: (f) => { f.artifacts[0].expected.runner_name = 'other-runner'; },
  };
  for (const [name, mutate] of Object.entries(mutations)) await t.test(name, async () => {
    const f = fixture(); mutate(f); await assert.rejects(collect(f));
  });
});

test('wrong or incomplete jobs cannot reuse successful annotation evidence', async (t) => {
  const mutations = {
    missing: (f) => f.jobSets[2].pop(),
    duplicate: (f) => f.jobSets[2].push(structuredClone(f.jobSets[2][0])),
    failed: (f) => { f.jobSets[2][0].conclusion = 'failure'; },
    running: (f) => { f.jobSets[2][0].status = 'in_progress'; },
    run: (f) => { f.jobSets[1][0].run_id = 41; },
    attempt: (f) => { f.jobSets[1][0].run_attempt = 2; },
    head: (f) => { f.jobSets[1][0].head_sha = 'd'.repeat(40); },
    runner: (f) => { f.jobSets[2][0].runner_id++; },
    start: (f) => { f.jobSets[2][0].started_at = '2026-09-14T12:11:01Z'; },
    end: (f) => { f.jobSets[2][0].completed_at = '2026-09-14T12:12:01Z'; },
    date: (f) => { f.jobSets[1][0].created_at = 'invalid'; },
    copied: (f) => { f.jobSets[1][0].created_at = '2026-09-14T12:30:00Z'; },
    endpoint: (f) => { f.jobSets[1][0].check_run_url = 'https://example.org/check-runs/10'; },
    metadata: (f) => { f.run.id = 41; },
  };
  for (const [name, mutate] of Object.entries(mutations)) await t.test(name, async () => {
    const f = fixture({ attempt: 2 }); mutate(f); await assert.rejects(collect(f));
  });
});

test('all pages of jobs and annotations participate in verification', async () => {
  const f = fixture();
  const jobsURL = `${f.root}/actions/runs/42/attempts/1/jobs?per_page=100&page=`;
  f.responses.set(jobsURL + '1', { jobs: Array.from({ length: 100 }, (_, i) => ({ name: `Unrelated ${i}` })) });
  f.responses.set(jobsURL + '2', { jobs: f.jobSets[1] });
  const annotationsURL = `${f.root}/check-runs/10/annotations?per_page=100&page=`;
  const actual = f.responses.get(annotationsURL + '1');
  f.responses.set(annotationsURL + '1', Array.from({ length: 100 }, () => ({ path: 'README.md', message: 'Unrelated notice' })));
  f.responses.set(annotationsURL + '2', actual);
  assert.equal((await collect(f))[0].annotations.length, 105);
  f.responses.get(annotationsURL + '2')[0].annotation_level = 'notice';
  await assert.rejects(collect(f));
});

test('collector entry point reads attempt artifacts and retains their executed job identities', async (t) => {
  const f = fixture({ attempt: 2, rerun: ['macos-latest'] });
  const directory = await mkdtemp(path.join(os.tmpdir(), 'unswell-annotations-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const artifact of f.artifacts) {
    const target = path.join(directory, 'artifacts/downloaded', artifact.name, 'diagnostic-evidence');
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, 'expected.json'), JSON.stringify(artifact.expected));
  }
  await writeFile(path.join(directory, 'responses.json'), JSON.stringify([...f.responses]));
  await writeFile(path.join(directory, 'fetch.mjs'), `
    import assert from 'node:assert/strict';
    import {readFile} from 'node:fs/promises';
    const responses = new Map(JSON.parse(await readFile(new URL('./responses.json', import.meta.url), 'utf8')));
    globalThis.fetch = async (url, options) => {
      assert.equal(options.headers.authorization, 'Bearer fixture-token');
      assert.ok(responses.has(url), url);
      return new Response(JSON.stringify(responses.get(url)), {status: 200});
    };
  `);
  await promisify(execFile)(process.execPath, ['--import', pathToFileURL(path.join(directory, 'fetch.mjs')).href,
    fileURLToPath(new URL('./verify-run-annotations.mjs', import.meta.url))], {
    cwd: directory, env: { ...process.env, GITHUB_REPOSITORY: f.context.repository, GITHUB_RUN_ID: f.context.runID,
      GITHUB_RUN_ATTEMPT: '2', GITHUB_SHA: f.context.actionCommit, UNSWELL_CLI_COMMIT: f.context.cliCommit,
      GITHUB_TOKEN: 'fixture-token' }, timeout: 30_000,
  });
  const result = JSON.parse(await readFile(path.join(directory, 'artifacts/annotation-verification/verified.json'), 'utf8'));
  assert.deepEqual(result.map((r) => [r.job, r.observed_job, r.run_attempt]), [[10, 20, 1], [21, 21, 2], [12, 22, 1]]);
});
