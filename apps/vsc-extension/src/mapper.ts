import { access, readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { Uri, type WorkspaceFolder } from 'vscode';
import type { ContentMapperManifest } from './api.js';

const mapperPackage = '@causeeffect/jsx-content-mapper';
interface Output {
  appendLine(message: string): void;
}
export interface ResolvedContentMapper {
  manifest: ContentMapperManifest & { cwd: Uri };
  runtimeModule: string;
  source: 'workspace' | 'bundled';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function loadMapper(
  manifestPath: string,
  source: ResolvedContentMapper['source'],
): Promise<ResolvedContentMapper> {
  const data: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
  const typescript = isRecord(data) ? data.typescript : undefined;
  const mapper = isRecord(typescript) ? typescript.contentMapper : undefined;
  if (
    !isRecord(data) ||
    data.name !== mapperPackage ||
    typeof data.version !== 'string' ||
    !isRecord(mapper) ||
    !Array.isArray(mapper.exec) ||
    !mapper.exec.length ||
    !mapper.exec.every(
      (part: unknown) => typeof part === 'string' && part.length > 0,
    ) ||
    (mapper.compilerOptions !== undefined &&
      (!Array.isArray(mapper.compilerOptions) ||
        !mapper.compilerOptions.every(
          (option: unknown) => typeof option === 'string',
        ))) ||
    (mapper.dynamicConfig !== undefined &&
      typeof mapper.dynamicConfig !== 'boolean')
  ) {
    throw new Error(`Invalid content mapper manifest at ${manifestPath}`);
  }
  const directory = dirname(manifestPath);
  const require = createRequire(manifestPath);
  const runtimeModule = require.resolve(`${mapperPackage}/runtime`);
  await access(runtimeModule);
  const exec: string[] = [...mapper.exec];
  // Use the extension host's Node runtime for this package's Node entry point.
  if (exec[0] === 'node') {
    exec[0] = process.execPath;
    if (exec[1] && !exec[1].startsWith('-'))
      await access(resolve(directory, exec[1]));
  }
  return {
    source,
    runtimeModule,
    manifest: {
      name: data.name,
      version: data.version,
      exec,
      cwd: Uri.file(directory),
      compilerOptions: (mapper.compilerOptions as string[] | undefined) ?? [],
      dynamicConfig: (mapper.dynamicConfig as boolean | undefined) ?? false,
    },
  };
}

/** A single inferred registration owns .gtsx globally; configured projects resolve their own mapper. */
export async function resolveContentMapper(
  folders: readonly WorkspaceFolder[],
  extensionUri: Uri,
  output: Output,
): Promise<ResolvedContentMapper> {
  if (folders.length === 1 && folders[0].uri.scheme === 'file') {
    try {
      const require = createRequire(
        join(folders[0].uri.fsPath, 'package.json'),
      );
      const ancestorDirectories = new Set<string>();
      let ancestor = folders[0].uri.fsPath;
      for (;;) {
        ancestorDirectories.add(join(ancestor, 'node_modules'));
        const parent = dirname(ancestor);
        if (parent === ancestor) break;
        ancestor = parent;
      }
      // Node also searches NODE_PATH and global folders. Those packages are not
      // workspace installs; use only the normal ancestor node_modules lookup.
      for (const directory of require.resolve.paths(mapperPackage) ?? []) {
        if (!ancestorDirectories.has(directory)) continue;
        const manifestPath = join(directory, mapperPackage, 'package.json');
        try {
          await access(manifestPath);
        } catch (error) {
          if (
            error instanceof Error &&
            'code' in error &&
            error.code === 'ENOENT'
          )
            continue;
          throw error;
        }
        return await loadMapper(await realpath(manifestPath), 'workspace');
      }
    } catch (error) {
      if (!(
        error instanceof Error &&
        'code' in error &&
        error.code === 'MODULE_NOT_FOUND'
      )) {
        output.appendLine(
          `Workspace mapper unavailable; using bundled mapper: ${String(error)}`,
        );
      }
    }
  }
  return loadMapper(
    join(extensionUri.fsPath, 'dist/mapper/package.json'),
    'bundled',
  );
}
