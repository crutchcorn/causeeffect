import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type * as VSCode from 'vscode';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const uris = vi.hoisted(() => {
  function file(path: string) {
    return {
      scheme: 'file',
      fsPath: path,
      path,
      toString: () => `file://${encodeURI(path)}`,
    };
  }
  return { file };
});
vi.mock('vscode', () => ({
  Uri: {
    file: uris.file,
    joinPath: (base: { fsPath: string }, ...segments: string[]) =>
      uris.file([base.fsPath.replace(/\/$/, ''), ...segments].join('/')),
  },
}));

import { resolveContentMapper } from './mapper.js';

const mapperName = '@causeeffect/jsx-content-mapper';
const mapperPackage = {
  name: mapperName,
  version: '0.0.1',
  type: 'module',
  exports: {
    './package.json': './package.json',
    './runtime': './dist/runtime.js',
  },
  typescript: {
    contentMapper: {
      exec: ['node', 'dist/server.js'],
      compilerOptions: ['jsxFactory', 'jsxFragmentFactory'],
      dynamicConfig: false,
    },
  },
};

let root: string;
let extension: string;
const output = { appendLine: vi.fn() };

async function write(path: string, contents: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}

async function installedMapper(
  workspace: string,
  packageJson: unknown = mapperPackage,
) {
  const packageRoot = join(workspace, 'node_modules', mapperName);
  await write(join(packageRoot, 'package.json'), JSON.stringify(packageJson));
  await write(
    join(packageRoot, 'dist/server.js'),
    '// content mapper subprocess',
  );
  await write(join(packageRoot, 'dist/runtime.js'), 'export {};');
  await write(join(packageRoot, 'dist/runtime.d.ts'), 'export {};');
  return packageRoot;
}

function folder(path: string, index = 0): VSCode.WorkspaceFolder {
  return {
    name: `project-${index}`,
    index,
    uri: uris.file(path),
  } as VSCode.WorkspaceFolder;
}

function extensionUri(): VSCode.Uri {
  return uris.file(extension) as VSCode.Uri;
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'gtsx-extension-')));
  extension = join(root, 'extension');
  const bundled = join(extension, 'dist/mapper');
  await write(
    join(bundled, 'package.json'),
    JSON.stringify({
      ...mapperPackage,
      exports: {
        './package.json': './package.json',
        './runtime': './runtime.js',
      },
      typescript: {
        contentMapper: {
          ...mapperPackage.typescript.contentMapper,
          exec: ['node', 'server.cjs'],
        },
      },
    }),
  );
  await write(
    join(bundled, 'server.cjs'),
    '// bundled content mapper subprocess',
  );
  await write(join(bundled, 'runtime.js'), 'export {};');
  await write(join(bundled, 'runtime.d.ts'), 'export {};');
  output.appendLine.mockClear();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('content mapper resolution', () => {
  it('uses the bundled mapper when no workspace is open', async () => {
    const resolved = await resolveContentMapper(
      [],
      extensionUri(),
      output as unknown as VSCode.OutputChannel,
    );
    expect(resolved).toMatchObject({
      source: 'bundled',
      runtimeModule: join(extension, 'dist/mapper/runtime.js'),
      manifest: {
        name: mapperName,
        version: '0.0.1',
        exec: [process.execPath, 'server.cjs'],
        compilerOptions: ['jsxFactory', 'jsxFragmentFactory'],
        dynamicConfig: false,
      },
    });
    expect(resolved.manifest.cwd.fsPath).toBe(join(extension, 'dist/mapper'));
  });

  it('uses a valid installed mapper and runtime from a single workspace', async () => {
    const workspace = join(root, 'project');
    const packageRoot = await installedMapper(workspace, {
      ...mapperPackage,
      version: '1.2.3',
    });
    const resolved = await resolveContentMapper(
      [folder(workspace)],
      extensionUri(),
      output as unknown as VSCode.OutputChannel,
    );
    expect(resolved.source).toBe('workspace');
    expect(resolved.manifest.version).toBe('1.2.3');
    expect(resolved.manifest.cwd.fsPath).toBe(packageRoot);
    expect(resolved.manifest.exec).toEqual([
      process.execPath,
      'dist/server.js',
    ]);
    expect(resolved.runtimeModule).toBe(join(packageRoot, 'dist/runtime.js'));
  });

  it('uses the bundled mapper when the workspace does not install the mapper', async () => {
    const workspace = join(root, 'project');
    await mkdir(workspace);
    const resolved = await resolveContentMapper(
      [folder(workspace)],
      extensionUri(),
      output as unknown as VSCode.OutputChannel,
    );
    expect(resolved.source).toBe('bundled');
  });

  it('resolves a mapper hoisted into an ancestor node_modules directory', async () => {
    const repository = join(root, 'repository');
    const workspace = join(repository, 'packages', 'ui');
    const packageRoot = await installedMapper(repository);
    await mkdir(workspace, { recursive: true });
    const resolved = await resolveContentMapper(
      [folder(workspace)],
      extensionUri(),
      output as unknown as VSCode.OutputChannel,
    );
    expect(resolved.source).toBe('workspace');
    expect(resolved.manifest.cwd.fsPath).toBe(packageRoot);
    expect(resolved.runtimeModule).toBe(join(packageRoot, 'dist/runtime.js'));
  });

  it('resolves a symlinked workspace package to its actual directory', async () => {
    const workspace = join(root, 'linked-project');
    const packageRoot = await installedMapper(join(root, 'package-store'));
    await mkdir(join(workspace, 'node_modules/@causeeffect'), {
      recursive: true,
    });
    await symlink(
      packageRoot,
      join(workspace, 'node_modules', mapperName),
      'dir',
    );
    const resolved = await resolveContentMapper(
      [folder(workspace)],
      extensionUri(),
      output as unknown as VSCode.OutputChannel,
    );
    expect(resolved.source).toBe('workspace');
    expect(resolved.manifest.cwd.fsPath).toBe(packageRoot);
    expect(resolved.runtimeModule).toBe(join(packageRoot, 'dist/runtime.js'));
  });

  it('uses a consistent bundled mapper for a multi-root workspace', async () => {
    const first = join(root, 'first');
    const second = join(root, 'second');
    await installedMapper(first, { ...mapperPackage, version: '1.0.0' });
    await installedMapper(second, { ...mapperPackage, version: '2.0.0' });
    const resolved = await resolveContentMapper(
      [folder(first), folder(second, 1)],
      extensionUri(),
      output as unknown as VSCode.OutputChannel,
    );
    expect(resolved.source).toBe('bundled');
    expect(resolved.manifest.version).toBe('0.0.1');
    expect(resolved.manifest.cwd.fsPath).toBe(join(extension, 'dist/mapper'));
  });

  it('ignores virtual workspace folders when resolving local subprocess packages', async () => {
    const workspace = folder(join(root, 'virtual'));
    const virtual = {
      ...workspace,
      uri: { ...workspace.uri, scheme: 'vscode-vfs' },
    } as VSCode.WorkspaceFolder;
    const resolved = await resolveContentMapper(
      [virtual],
      extensionUri(),
      output as unknown as VSCode.OutputChannel,
    );
    expect(resolved.source).toBe('bundled');
  });

  it('warns and falls back when workspace mapper metadata is invalid', async () => {
    const workspace = join(root, 'invalid');
    await installedMapper(workspace, {
      ...mapperPackage,
      typescript: { contentMapper: { exec: ['node', 123] } },
    });
    const resolved = await resolveContentMapper(
      [folder(workspace)],
      extensionUri(),
      output as unknown as VSCode.OutputChannel,
    );
    expect(resolved.source).toBe('bundled');
    expect(output.appendLine).toHaveBeenCalled();
  });

  it('falls back when the installed runtime is missing', async () => {
    const workspace = join(root, 'missing-runtime');
    const packageRoot = await installedMapper(workspace);
    await rm(join(packageRoot, 'dist/runtime.js'));
    const resolved = await resolveContentMapper(
      [folder(workspace)],
      extensionUri(),
      output as unknown as VSCode.OutputChannel,
    );
    expect(resolved.source).toBe('bundled');
  });

  it('reports missing bundled artifacts instead of registering an unusable subprocess', async () => {
    await rm(join(extension, 'dist/mapper/server.cjs'));
    await expect(
      resolveContentMapper(
        [],
        extensionUri(),
        output as unknown as VSCode.OutputChannel,
      ),
    ).rejects.toThrow();
  });
});
