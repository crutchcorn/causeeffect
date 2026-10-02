import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mapperManifestPath =
  require.resolve('@causeeffect/jsx-content-mapper/package.json');
const mapperRoot = dirname(mapperManifestPath);
const mapper = JSON.parse(await readFile(mapperManifestPath, 'utf8'));

execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    '-p',
    join(mapperRoot, 'tsconfig.lib.json'),
  ],
  { stdio: 'inherit' },
);
await rm(join(root, 'dist'), { recursive: true, force: true });
await mkdir(join(root, 'dist/mapper'), { recursive: true });
await build({
  entryPoints: [join(root, 'src/extension.ts')],
  outfile: join(root, 'dist/extension.cjs'),
  bundle: true,
  external: ['vscode'],
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: true,
  legalComments: 'external',
});
const mapperBuild = await build({
  entryPoints: [join(mapperRoot, 'dist/server.js')],
  outfile: join(root, 'dist/mapper/server.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  legalComments: 'external',
  metafile: true,
});
// Preserve the full licenses of packages included in the subprocess bundle.
const notices = new Map();
for (const input of Object.keys(mapperBuild.metafile.inputs)) {
  let directory = dirname(resolve(input));
  while (directory !== dirname(directory)) {
    let manifest;
    try {
      manifest = JSON.parse(
        await readFile(join(directory, 'package.json'), 'utf8'),
      );
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      directory = dirname(directory);
      continue;
    }
    if (directory !== mapperRoot && !notices.has(manifest.name)) {
      const files = (await readdir(directory)).filter((name) =>
        /^(licen[cs]e|notice)(\..*)?$/i.test(name),
      );
      const text = await Promise.all(
        files.map((name) => readFile(join(directory, name), 'utf8')),
      );
      notices.set(
        manifest.name,
        `${manifest.name}@${manifest.version}\n${text.join('\n')}`,
      );
    }
    break;
  }
}
await writeFile(
  join(root, 'dist/THIRD_PARTY_NOTICES.txt'),
  [...notices.values()].join('\n\n---\n\n') + '\n',
);
for (const name of ['runtime.js', 'runtime.d.ts']) {
  await cp(join(mapperRoot, 'dist', name), join(root, 'dist/mapper', name));
}
await writeFile(
  join(root, 'dist/mapper/package.json'),
  JSON.stringify(
    {
      name: mapper.name,
      version: mapper.version,
      type: 'module',
      exports: {
        './package.json': './package.json',
        './runtime': { types: './runtime.d.ts', default: './runtime.js' },
      },
      typescript: {
        contentMapper: {
          exec: ['node', 'server.cjs'],
          compilerOptions: mapper.typescript.contentMapper.compilerOptions,
          dynamicConfig: mapper.typescript.contentMapper.dynamicConfig,
        },
      },
    },
    null,
    2,
  ) + '\n',
);
