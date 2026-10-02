import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { versionFromTag, successfulTagRun, verifyPackage, verifyAssets, alreadyPublished } from '../scripts/npm-release.mjs';

const repo = 'higekibaka/dsh-web-low-motion';
const sha = 'a'.repeat(40);
const tag = 'v0.5.3';
const context = { repo, sha, tag };
const validRun = { path: '.github/workflows/ci.yml', event: 'push', head_branch: tag, head_sha: sha,
  head_repository: { full_name: repo }, repository: { full_name: repo }, status: 'completed', conclusion: 'success' };

test('npm release accepts only stable version tags and the intended package', () => {
  assert.equal(versionFromTag(tag), '0.5.3');
  for (const value of ['main', 'v01.2.3', 'v0.5.3-rc.1', 'v0.5.3;echo unsafe', 'v0.5.3\n', undefined]) {
    assert.throws(() => versionFromTag(value));
  }
  const pkg = { name: 'dsh-web-low-motion', version: '0.5.3', repository: { url: 'git+https://github.com/' + repo + '.git' } };
  verifyPackage(pkg, tag);
  for (const change of [{ name: 'another-package' }, { version: '0.5.4' }, { repository: { url: 'https://example.com/' } }]) {
    assert.throws(() => verifyPackage({ ...pkg, ...change }, tag));
  }
});

test('npm release requires successful CI from the exact tag, commit and repository', () => {
  assert.equal(successfulTagRun(validRun, context), true);
  for (const change of [
    { event: 'pull_request' }, { event: 'workflow_dispatch' }, { head_branch: 'main' }, { head_sha: 'b'.repeat(40) },
    { status: 'in_progress' }, { conclusion: 'failure' }, { conclusion: 'cancelled' }, { conclusion: 'skipped' },
    { path: '.github/workflows/other.yml' }, { head_repository: { full_name: 'fork/repo' } }, { repository: { full_name: 'fork/repo' } },
  ]) assert.equal(successfulTagRun({ ...validRun, ...change }, context), false, JSON.stringify(change));
});

test('npm release rejects mismatched assets, checksums and existing npm versions', () => {
  const bytes = Buffer.from('verified package');
  const filename = 'dsh-web-low-motion-0.5.3.tgz';
  const sums = createHash('sha256').update(bytes).digest('hex') + '  ' + filename + '\n';
  const integrity = verifyAssets(bytes, Buffer.from(bytes), sums, filename);
  assert.equal(integrity, 'sha512-' + createHash('sha512').update(bytes).digest('base64'));
  assert.throws(() => verifyAssets(bytes, Buffer.from('tampered'), sums, filename));
  assert.throws(() => verifyAssets(bytes, bytes, 'invalid', filename));
  assert.throws(() => verifyAssets(bytes, bytes, sums + 'extra-file', filename));
  assert.equal(alreadyPublished(null, integrity), false);
  assert.equal(alreadyPublished({ dist: { integrity } }, integrity), true);
  assert.throws(() => alreadyPublished({ dist: { integrity: 'sha512-different' } }, integrity));
});

test('OIDC workflow and maintainer documentation retain the publishing security contract', () => {
  const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  const docs = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const [prepare, publish] = workflow.split('  publish:\n');
  assert.match(prepare, /workflow_dispatch:/);
  assert.match(prepare, /npm-release\.mjs gate/);
  assert.match(prepare, /npm-release\.mjs verify/);
  assert.doesNotMatch(prepare, /id-token: write/);
  assert.match(publish, /needs: prepare/);
  assert.match(publish, /id-token: write/);
  assert.match(publish, /npm publish .*--ignore-scripts --provenance --access public/);
  assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN|NPM_TOKEN|secrets\./);
  for (const word of ['Trusted Publishing', 'higekibaka', 'dsh-web-low-motion', 'release.yml', 'workflow_dispatch']) assert.ok(docs.includes(word));
});
