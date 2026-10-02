/**
 * Runs the smoke test in a real VS Code extension host with isolated settings.
 * Overrides: CODE_BINARY (the Code CLI), NATIVE_EXTENSION_PATH (an installed
 * TypeScriptTeam.native-preview directory), HOST_TEST_TIMEOUT_MS, and
 * KEEP_HOST_TEST_ARTIFACTS=1 (preserve the temporary profile and logs).
 */
import { execFileSync, spawn } from 'node:child_process';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const codeBinary =
  process.env.CODE_BINARY ??
  (process.platform === 'darwin'
    ? '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'
    : 'code');

async function nativeExtensionPath() {
  if (process.env.NATIVE_EXTENSION_PATH)
    return resolve(process.env.NATIVE_EXTENSION_PATH);
  for (const directory of [
    join(homedir(), '.vscode-insiders/extensions'),
    join(homedir(), '.vscode/extensions'),
  ]) {
    const entries = await readdir(directory).catch(() => []);
    const candidates = entries
      .filter((name) => name.startsWith('typescriptteam.native-preview-'))
      .sort()
      .reverse();
    if (candidates.length) return join(directory, candidates[0]);
  }
  throw new Error(
    'Set NATIVE_EXTENSION_PATH to an installed TypeScriptTeam.native-preview extension.',
  );
}

execFileSync(process.execPath, [join(extensionRoot, 'scripts/build.mjs')], {
  cwd: extensionRoot,
  stdio: 'inherit',
});
await access(join(extensionRoot, 'dist/extension.cjs'));
const nativePath = await nativeExtensionPath();
const sdkPath = join(
  dirname(require.resolve('typescript-next/package.json')),
  'lib',
);
// macOS's default TMPDIR is long enough to exceed Unix socket path limits.
const temporary = await realpath(
  await mkdtemp(
    join(process.platform === 'darwin' ? '/tmp' : tmpdir(), 'gtsx-host-'),
  ),
);
const userData = join(temporary, 'user-data');
const extensions = join(temporary, 'extensions');
const workspace = join(temporary, 'workspace');
const resultPath = join(temporary, 'result.json');
let passed = false;

try {
  await Promise.all([
    mkdir(join(userData, 'User'), { recursive: true }),
    mkdir(extensions),
    mkdir(workspace),
  ]);
  const nativeManifest = JSON.parse(
    await readFile(join(nativePath, 'package.json'), 'utf8'),
  );
  if (
    nativeManifest.publisher !== 'TypeScriptTeam' ||
    nativeManifest.name !== 'native-preview'
  ) {
    throw new Error(
      `NATIVE_EXTENSION_PATH is not the TypeScript native extension: ${nativePath}`,
    );
  }
  await symlink(
    nativePath,
    join(extensions, `typescriptteam.native-preview-${nativeManifest.version}`),
    'dir',
  );
  await writeFile(
    join(userData, 'User/settings.json'),
    JSON.stringify(
      {
        'js/ts.experimental.useTsgo': true,
        'js/ts.contentMappers.enabled': true,
        'js/ts.tsdk.path': sdkPath,
        'js/ts.trace.server': 'off',
        'security.workspace.trust.enabled': false,
        'extensions.autoCheckUpdates': false,
        'extensions.autoUpdate': false,
        'extensions.ignoreRecommendations': true,
        'telemetry.telemetryLevel': 'off',
        'update.mode': 'none',
        'workbench.startupEditor': 'none',
        'window.restoreWindows': 'none',
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(workspace, 'counter.gtsx'),
    `export function* Counter({ count }: { count: number }) {
  yield count;
  return <p>Hello</p>;
}
`,
  );
  await writeFile(
    join(workspace, 'main.gtsx'),
    `import { Counter } from './counter.gtsx';
export const Result = <Counter count={123} />;
export const invalid = <Counter count="wrong" />;
`,
  );
  const timeoutMs = Number(process.env.HOST_TEST_TIMEOUT_MS ?? 90_000);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error('HOST_TEST_TIMEOUT_MS must be a positive number.');
  console.log(`Testing GTSX in an isolated VS Code profile (${temporary}).`);
  const child = spawn(
    codeBinary,
    [
      '--new-window',
      '--wait',
      '--verbose',
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-workspace-trust',
      '--disable-updates',
      '--user-data-dir',
      userData,
      '--extensions-dir',
      extensions,
      '--extensionDevelopmentPath',
      extensionRoot,
      '--extensionTestsPath',
      join(extensionRoot, 'tests/host.cjs'),
      workspace,
    ],
    {
      cwd: extensionRoot,
      env: {
        ...process.env,
        GTSX_HOST_WORKSPACE: workspace,
        GTSX_HOST_TEST_RESULT: resultPath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let processOutput = '';
  const capture = (data) => {
    processOutput += data.toString();
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  const timeout = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
  try {
    await new Promise((accept, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) =>
        code === 0
          ? accept()
          : reject(
              new Error(
                `VS Code host smoke test exited with ${code ?? signal}.`,
              ),
            ),
      );
    });
  } finally {
    clearTimeout(timeout);
    await writeFile(join(temporary, 'code.log'), processOutput);
  }
  const result = JSON.parse(
    await readFile(resultPath, 'utf8').catch((error) => {
      throw new Error(
        `VS Code did not run the smoke test. See ${join(temporary, 'code.log')}.`,
        { cause: error },
      );
    }),
  );
  if (!result.passed)
    throw new Error(
      `The VS Code test runner did not report success: ${JSON.stringify(result)}`,
    );
  console.log(
    `VS Code ${result.vscodeVersion}: GTSX activation, generator hover, diagnostics, and cross-file definition passed.`,
  );
  console.log(result.hover);
  passed = true;
} finally {
  if (passed && process.env.KEEP_HOST_TEST_ARTIFACTS !== '1') {
    await rm(temporary, { recursive: true, force: true });
  } else {
    console.log(`VS Code test artifacts: ${temporary}`);
  }
}
