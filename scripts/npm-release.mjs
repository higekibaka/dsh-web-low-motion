import assert from 'node:assert/strict';
import { appendFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function versionFromTag(tag) {
  assert.match(tag ?? '', /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  return tag.slice(1);
}

export function successfulTagRun(run, { tag, sha, repo }) {
  return run.path === '.github/workflows/ci.yml' && run.event === 'push'
    && run.head_branch === tag && run.head_sha === sha
    && run.head_repository?.full_name === repo && run.repository?.full_name === repo
    && run.status === 'completed' && run.conclusion === 'success';
}

export function verifyPackage(pkg, tag) {
  assert.equal(pkg.name, 'dsh-web-low-motion');
  assert.equal(pkg.version, versionFromTag(tag));
  assert.equal(pkg.repository?.url, 'git+https://github.com/higekibaka/dsh-web-low-motion.git');
}

export function verifyAssets(local, published, sums, filename) {
  assert.ok(local.equals(published), 'Package differs from the GitHub Release asset');
  const sha256 = createHash('sha256').update(local).digest('hex');
  assert.equal(sums.trim(), sha256 + '  ' + filename, 'Release checksum mismatch');
  return 'sha512-' + createHash('sha512').update(local).digest('base64');
}

export function alreadyPublished(metadata, integrity) {
  if (metadata === null) return false;
  assert.equal(metadata.dist?.integrity, integrity, 'npm already contains different content for this version');
  return true;
}

async function main(action) {
  const { RELEASE_TAG: tag, GITHUB_REPOSITORY: repo, GH_TOKEN: token } = process.env;
  const version = versionFromTag(tag);
  assert.equal(repo, 'higekibaka/dsh-web-low-motion');
  const api = async path => {
    const response = await fetch('https://api.github.com/repos/' + repo + path, {
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' },
    });
    assert.ok(response.ok, 'GitHub HTTP ' + response.status + ' for ' + path);
    return response.json();
  };
  const output = async entries => {
    const text = Object.entries(entries).map(([key, value]) => key + '=' + value).join('\n') + '\n';
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, text);
    console.log(text.trim());
  };
  const tagCommit = async () => (await api('/commits/' + encodeURIComponent('refs/tags/' + tag))).sha;
  if (action === 'gate') {
    const sha = await tagCommit();
    assert.match(sha, /^[a-f0-9]{40}$/);
    if (process.env.GITHUB_EVENT_NAME === 'push') {
      assert.equal(process.env.GITHUB_REF, 'refs/tags/' + tag);
      assert.equal(process.env.GITHUB_SHA, sha);
    }
    // CI includes all host jobs and the matching GitHub Release; no branch/PR fallback.
    for (let attempt = 0; attempt < 140; attempt++) {
      const data = await api('/actions/workflows/ci.yml/runs?event=push&head_sha=' + sha + '&per_page=100');
      const run = data.workflow_runs.find(run => successfulTagRun(run, { tag, sha, repo }));
      if (run) {
        assert.equal(await tagCommit(), sha, 'Tag moved while waiting for CI');
        console.log('Validated tag CI: ' + run.html_url);
        await output({ sha });
        return;
      }
      if (process.env.GITHUB_EVENT_NAME === 'workflow_dispatch') throw Error('No successful CI for this exact tag and commit; run tag CI first');
      await new Promise(resolve => setTimeout(resolve, 15000));
    }
    throw Error('Timed out waiting for successful tag CI');
  }
  assert.equal(action, 'verify');
  assert.equal(await tagCommit(), process.env.RELEASE_SHA, 'Tag moved after CI validation');
  const pkg = JSON.parse(await readFile('release-source/package.json', 'utf8'));
  verifyPackage(pkg, tag);
  const filename = pkg.name + '-' + version + '.tgz';
  const release = await api('/releases/tags/' + tag);
  assert.equal(release.tag_name, tag);
  assert.equal(release.draft, false);
  assert.equal(release.prerelease, false);
  const download = async name => {
    const asset = release.assets.find(asset => asset.name === name);
    assert.ok(asset, 'Missing release asset: ' + name);
    const response = await fetch(asset.browser_download_url);
    assert.ok(response.ok, 'Release download HTTP ' + response.status);
    return Buffer.from(await response.arrayBuffer());
  };
  const local = await readFile('npm-package/' + filename);
  const integrity = verifyAssets(local, await download(filename), (await download('SHA256SUMS')).toString(), filename);
  const response = await fetch('https://registry.npmjs.org/' + pkg.name + '/' + version);
  assert.ok(response.ok || response.status === 404, 'npm lookup HTTP ' + response.status);
  const published = alreadyPublished(response.status === 404 ? null : await response.json(), integrity);
  await output({ filename, integrity, published });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv[2]);
}
