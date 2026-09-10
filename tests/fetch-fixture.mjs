// The test runner substitutes a release-shaped archive built from a pinned CLI.
// Production installs have no alternate URL or executable input.
import { readFile } from 'node:fs/promises';

const fixture = JSON.parse(await readFile(process.env.UNSWELL_RELEASE_FIXTURE, 'utf8'));
const root = `https://github.com/stokaro/unswell/releases/download/v${fixture.version}`;
globalThis.fetch = async (url) => {
  if (url === `${root}/SHA256SUMS`) return new Response(fixture.checksum);
  if (url === `${root}/${fixture.asset}`) return new Response(await readFile(fixture.archive));
  throw new Error(`Unexpected test download: ${url}`);
};
