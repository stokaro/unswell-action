import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { diagnosticFixtures } from './diagnostic-fixtures.mjs';
import { releaseFixture } from './release-fixture.mjs';

const directory = path.resolve('artifacts/diagnostic consumer');
await diagnosticFixtures(directory);
const fixture = await releaseFixture(process.env.UNSWELL_TEST_BINARY, path.join(process.env.RUNNER_TEMP, 'diagnostic-release'));
await mkdir('artifacts/diagnostic-evidence', { recursive: true });
await writeFile('artifacts/consumer-matcher.json', JSON.stringify({ problemMatcher: [{
  owner: 'unswell', severity: 'notice', pattern: [{ regexp: '^CONSUMER_PROBE (.+)$', message: 1 }],
}] }));
await appendFile(process.env.GITHUB_OUTPUT, `fixture=${fixture}\nhook=${new URL('./fetch-fixture.mjs', import.meta.url).href}\n`);
