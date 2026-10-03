import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const fixtureDirectory = path.join(root, 'src/content/articles/publishing-fixture');
const fixtureFile = path.join(fixtureDirectory, 'index.md');
const route = '/2099/12/31/publishing-fixture/';
const npm = process.platform === 'win32' ? process.env.ComSpec : 'npm';
const npmArgs = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm.cmd run build'] : ['run', 'build'];

function build() {
  const result = spawnSync(npm, npmArgs, { cwd: root, encoding: 'utf8', stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`构建失败，退出码 ${result.status}`);
}

async function assertRoute(expected) {
  const target = path.join(root, 'dist', route.slice(1), 'index.html');
  const exists = await import('node:fs/promises').then(({ access }) => access(target).then(() => true).catch(() => false));
  if (exists !== expected) throw new Error(`draft 发布门槛错误：${route} 存在=${exists}，预期=${expected}`);
}

try {
  await mkdir(fixtureDirectory, { recursive: true });
  const base = `---\ntitle: "Publishing fixture"\ndescription: "Build workflow fixture"\npublished: "2099-12-31"\npermalink: "${route}"\ncategories: []\ntags: []\n`;
  await writeFile(fixtureFile, `${base}draft: true\n---\n\nDraft body.\n`, 'utf8');
  build();
  await assertRoute(false);
  await writeFile(fixtureFile, `${base}draft: false\n---\n\nPublished body.\n`, 'utf8');
  build();
  await assertRoute(true);
  console.log('Publishing workflow test passed: draft excluded, published Markdown included.');
} finally {
  await rm(fixtureDirectory, { recursive: true, force: true });
  build();
}
