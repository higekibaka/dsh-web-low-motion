import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { posix } from 'node:path';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const pkg = JSON.parse(read('package.json'));

test('release version, installation example and latest changelog stay aligned', () => {
  const readme = read('README.md');
  assert.ok(readme.includes('**' + pkg.name + ' ' + pkg.version + '**'));
  assert.deepEqual([...readme.matchAll(/dsh-web-low-motion-([0-9.]+)\.tgz/g)].map(m => m[1]), [pkg.version]);
  assert.equal(read('CHANGELOG.md').match(/^## ([^ ]+)/m)?.[1], pkg.version);
  assert.doesNotMatch(readme, /本地开发版|尚未发布|开发目录适配/);
});

test('published documentation has no missing files or local links outside the package', () => {
  const files = new Set(['package.json', ...pkg.files]);
  for (const path of files) {
    assert.ok(existsSync(new URL(path, root)), 'Missing package file: ' + path);
    if (!path.endsWith('.md')) continue;
    for (const match of read(path).matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
      const link = match[1].split('#')[0];
      if (!link || /^[a-z]+:/i.test(link)) continue;
      const target = posix.normalize(posix.join(posix.dirname(path), link));
      assert.ok(files.has(target), path + ' links outside published package: ' + target);
    }
  }
});

test('documented host pins match CI and modern variants cannot silently skip', () => {
  const ci = read('.github/workflows/ci.yml');
  const docs = read('docs/compatibility-017.md') + read('docs/compatibility-020.md');
  const pins = [...ci.matchAll(/target: (dsh-v[^\s]+)\s+commit: ([a-f0-9]{40})/g)];
  assert.equal(pins.length, 4);
  for (const [, target, commit] of pins) {
    assert.ok(docs.includes(target.slice(5)), 'Missing documented host ' + target);
    assert.ok(docs.includes(commit), 'Missing documented commit ' + commit);
  }
  assert.match(ci, /modern: smil/);
  assert.match(ci, /modern: apng/);
  assert.match(ci, /DSH_MODERN_VARIANT:.*matrix.modern/);
});
