import { spawn, spawnSync } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-jsonrpc/node';
import { beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const extensionDirectory = resolve(import.meta.dirname, '..');
const bundledMapperDirectory = join(extensionDirectory, 'dist/mapper');
const runtimeModule = join(bundledMapperDirectory, 'runtime.js');
const repositoryDirectory = resolve(extensionDirectory, '../..');
const foldkitExampleDirectory = join(repositoryDirectory, 'examples/foldkit');
const foldkitAdapterDirectory = join(
  repositoryDirectory,
  'packages/foldkit-jsx',
);
let nativeCompiler: string;

interface Position {
  line: number;
  character: number;
}

interface Range {
  start: Position;
  end: Position;
}

interface Hover {
  contents: { kind: string; value: string };
  range: Range;
}

interface Location {
  uri: string;
  range: Range;
}

interface Diagnostic {
  code: number | string;
  severity: number;
  range: Range;
  message: string;
}

interface DiagnosticReport {
  kind: string;
  items: Diagnostic[];
}

interface WorkspaceEdit {
  changes: Record<string, { range: Range; newText: string }[]>;
}

interface Registration {
  method: string;
  registerOptions: { documentSelector?: { pattern: string }[] };
}

interface ConfigurationRequest {
  items: { section: string }[];
}

const component = `export function* Counter({ count }: { count: number }) {
  yield count;
  return <p>Hello</p>;
}
`;
const source = `import { Counter } from './counter.gtsx';
export const Result = <Counter count={123} />;
const emoji = '🦊'; export const invalid = <Counter count="wrong" />;
`;

function positionOf(text: string, value: string, occurrence = 0): Position {
  let offset = -1;
  for (let index = 0; index <= occurrence; index++) {
    offset = text.indexOf(value, offset + 1);
    if (offset === -1) throw new Error(`Cannot find ${value} in fixture`);
  }
  const preceding = text.slice(0, offset);
  const lines = preceding.split('\n');
  return { line: lines.length - 1, character: lines.at(-1)?.length ?? 0 };
}

function rangeOf(text: string, value: string, occurrence = 0): Range {
  const start = positionOf(text, value, occurrence);
  return {
    start,
    end: { line: start.line, character: start.character + value.length },
  };
}

async function project(configured: boolean) {
  const directory = await mkdtemp(join(tmpdir(), 'gtsx-lsp-'));
  await mkdir(join(directory, 'node_modules/@causeeffect'), {
    recursive: true,
  });
  await symlink(
    bundledMapperDirectory,
    join(directory, 'node_modules/@causeeffect/jsx-content-mapper'),
    'dir',
  );
  await Promise.all([
    writeFile(
      join(directory, 'package.json'),
      JSON.stringify({ type: 'module' }),
    ),
    writeFile(join(directory, 'counter.gtsx'), component),
    writeFile(join(directory, 'main.gtsx'), source),
    ...(configured
      ? [
          writeFile(
            join(directory, 'tsconfig.json'),
            JSON.stringify({
              compilerOptions: {
                target: 'es2022',
                lib: ['es2022', 'dom'],
                module: 'esnext',
                moduleResolution: 'bundler',
                strict: true,
                noEmit: true,
                types: [],
              },
              contentMappers: [
                {
                  package: '@causeeffect/jsx-content-mapper',
                  extensions: ['.gtsx'],
                },
              ],
              include: ['*.gtsx'],
            }),
          ),
        ]
      : []),
  ]);
  return directory;
}

function client(directory: string) {
  const server = spawn(process.execPath, [nativeCompiler, '--lsp', '--stdio'], {
    cwd: directory,
    stdio: 'pipe',
  });
  let serverErrors = '';
  const registrations: Registration[] = [];
  server.stderr.on('data', (data: Buffer) => {
    serverErrors += data.toString();
  });
  const exited = new Promise<void>((resolve) => {
    server.once('close', () => resolve());
  });
  const connection = createMessageConnection(
    new StreamMessageReader(server.stdout),
    new StreamMessageWriter(server.stdin),
  );
  connection.onRequest(
    'workspace/configuration',
    (params: ConfigurationRequest) => params.items.map(() => ({})),
  );
  connection.onRequest(
    'client/registerCapability',
    (params: { registrations: Registration[] }) => {
      registrations.push(...params.registrations);
      return null;
    },
  );
  connection.onRequest('client/unregisterCapability', () => null);
  // Native TypeScript logs through LSP rather than stderr. Drain notifications
  // without flooding test output with its project-discovery trace.
  connection.onNotification(() => undefined);
  connection.listen();

  async function request<T>(method: string, params: unknown): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        connection.sendRequest<T>(method, params),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`LSP ${method} timed out. ${serverErrors}`)),
            10_000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
  }

  async function initialize() {
    const initialized = await request<{ serverInfo: { version: string } }>(
      'initialize',
      {
        processId: process.pid,
        rootUri: pathToFileURL(directory).href,
        capabilities: {
          general: { positionEncodings: ['utf-16'] },
          workspace: {
            configuration: true,
            didChangeWatchedFiles: { dynamicRegistration: true },
          },
          textDocument: {
            synchronization: { dynamicRegistration: true },
            hover: { dynamicRegistration: true },
            definition: { dynamicRegistration: true },
            diagnostic: { dynamicRegistration: true },
          },
        },
        initializationOptions: {
          runExternalCode: true,
          disablePushDiagnostics: true,
          enableTelemetry: false,
        },
      },
    );
    expect(initialized.serverInfo.version).toMatch(/^7\.1\./);
    await connection.sendNotification('initialized', {});
    // This is the native extension's wire representation of a registration.
    // The configured fixture resolves its mapper through tsconfig instead.
    await request('custom/setContentMapperContributions', {
      contributions: [
        {
          contributorId: 'causeeffect.gtsx',
          extensions: ['.gtsx'],
          inferredProjectContribution: {
            manifest: {
              name: '@causeeffect/jsx-content-mapper',
              version: '0.0.1',
              exec: [
                process.execPath,
                join(bundledMapperDirectory, 'server.cjs'),
              ],
              cwd: bundledMapperDirectory,
              compilerOptions: ['jsxFactory', 'jsxFragmentFactory'],
              dynamicConfig: false,
            },
            options: { runtimeModule },
          },
        },
      ],
      openDocuments: [],
    });
  }

  async function dispose() {
    // This nightly waits for mapper processes on `shutdown`. `exit` gives the
    // test the same process-level cleanup as terminating the extension host.
    await connection.sendNotification('exit').catch(() => undefined);
    const forceExit = setTimeout(() => server.kill('SIGKILL'), 2_000);
    try {
      await exited;
    } finally {
      clearTimeout(forceExit);
      connection.dispose();
    }
  }

  return { initialize, request, connection, registrations, dispose };
}

describe('GTSX with the native TypeScript 7.1 language server', () => {
  beforeAll(async () => {
    const manifestPath = require.resolve('typescript-next/package.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      version: string;
      bin: { tsc: string };
    };
    expect(manifest.version).toMatch(/^7\.1\./);
    nativeCompiler = join(dirname(manifestPath), manifest.bin.tsc);
    const build = spawnSync(process.execPath, ['scripts/build.mjs'], {
      cwd: extensionDirectory,
      encoding: 'utf8',
      timeout: 30_000,
    });
    if (build.error) throw build.error;
    expect(build.status, build.stdout + build.stderr).toBe(0);
    // The real example consumes the adapter's declarations. Prepare them from
    // source so this test also works immediately after a fresh workspace install.
    const adapterBuild = spawnSync(
      process.execPath,
      [
        require.resolve('typescript/bin/tsc'),
        '-p',
        join(foldkitAdapterDirectory, 'tsconfig.lib.json'),
      ],
      { cwd: foldkitAdapterDirectory, encoding: 'utf8', timeout: 30_000 },
    );
    if (adapterBuild.error) throw adapterBuild.error;
    expect(adapterBuild.status, adapterBuild.stdout + adapterBuild.stderr).toBe(
      0,
    );
  }, 30_000);

  it.each([
    { name: 'configured', configured: true },
    { name: 'inferred', configured: false },
  ])(
    'provides mapped hovers, definitions, diagnostics, and edits in a $name project',
    async ({ configured }) => {
      const directory = await project(configured);
      const lsp = client(directory);
      const uri = pathToFileURL(join(directory, 'main.gtsx')).href;
      const textDocument = { uri };
      try {
        await lsp.initialize();
        expect(lsp.registrations).toContainEqual({
          id: 'content-mapper-hover',
          method: 'textDocument/hover',
          registerOptions: { documentSelector: [{ pattern: '**/*.gtsx' }] },
        });
        await lsp.connection.sendNotification('textDocument/didOpen', {
          textDocument: { uri, languageId: 'gtsx', version: 1, text: source },
        });

        const hover = await lsp.request<Hover>('textDocument/hover', {
          textDocument,
          position: positionOf(source, 'Result'),
        });
        expect(hover.contents.value).toBe(
          'const Result: JSX.GeneratorElement<number, JSX.GeneratorElement<never, never, never>, unknown>',
        );
        expect(hover.range).toEqual(rangeOf(source, 'Result'));

        const definition = await lsp.request<Location[]>(
          'textDocument/definition',
          { textDocument, position: positionOf(source, 'Counter', 1) },
        );
        expect(definition).toEqual([
          {
            uri: pathToFileURL(join(directory, 'counter.gtsx')).href,
            range: rangeOf(component, 'Counter'),
          },
        ]);

        const diagnostics = await lsp.request<DiagnosticReport>(
          'textDocument/diagnostic',
          { textDocument, identifier: 'typescript' },
        );
        expect(diagnostics.kind).toBe('full');
        expect(diagnostics.items.filter((item) => item.severity === 1)).toEqual(
          [
            expect.objectContaining({
              code: 2322,
              range: rangeOf(source, 'count', 2),
              message: "Type 'string' is not assignable to type 'number'.",
            }),
          ],
        );

        const info = await lsp.request<{ configFilePath: string }>(
          'custom/projectInfo',
          { textDocument },
        );
        expect(info.configFilePath).toBe(
          configured ? join(directory, 'tsconfig.json') : '',
        );

        await lsp.connection.sendNotification('textDocument/didChange', {
          textDocument: { uri, version: 2 },
          contentChanges: [
            { range: rangeOf(source, '"wrong"'), text: '{456}' },
          ],
        });
        const edited = await lsp.request<DiagnosticReport>(
          'textDocument/diagnostic',
          { textDocument, identifier: 'typescript' },
        );
        expect(edited.items.filter((item) => item.severity === 1)).toEqual([]);

        const rename = await lsp.request<WorkspaceEdit>('textDocument/rename', {
          textDocument,
          position: positionOf(source, 'Counter', 1),
          newName: 'Updated',
        });
        expect(rename.changes).toEqual({
          [uri]: [
            {
              range: rangeOf(source, 'Counter'),
              newText: 'Counter as Updated',
            },
            {
              range: rangeOf(source, 'Counter', 1),
              newText: 'Updated',
            },
            {
              range: rangeOf(source, 'Counter', 2),
              newText: 'Updated',
            },
          ],
        });
      } finally {
        await lsp.dispose();
        await rm(directory, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it('honors the Foldkit example classic configuration while a generator fallback is registered', async () => {
    const appFile = join(foldkitExampleDirectory, 'src/app.gtsx');
    const counterFile = join(foldkitExampleDirectory, 'src/counter.gtsx');
    const [appSource, counterSource] = await Promise.all([
      readFile(appFile, 'utf8'),
      readFile(counterFile, 'utf8'),
    ]);
    const lsp = client(foldkitExampleDirectory);
    const uri = pathToFileURL(appFile).href;
    const textDocument = { uri };
    try {
      await lsp.initialize();
      await lsp.connection.sendNotification('textDocument/didOpen', {
        textDocument: { uri, languageId: 'gtsx', version: 1, text: appSource },
      });

      const info = await lsp.request<{ configFilePath: string }>(
        'custom/projectInfo',
        { textDocument },
      );
      expect(info.configFilePath).toBe(
        join(foldkitExampleDirectory, 'tsconfig.json'),
      );

      const diagnostics = await lsp.request<DiagnosticReport>(
        'textDocument/diagnostic',
        { textDocument, identifier: 'typescript' },
      );
      expect(diagnostics.items.filter((item) => item.severity === 1)).toEqual(
        [],
      );

      const hover = await lsp.request<Hover>('textDocument/hover', {
        textDocument,
        position: positionOf(appSource, 'view = (model'),
      });
      expect(hover.contents.value).toBe(
        'const view: (model: Model, h: HtmlBuilder<Message>) => Document',
      );

      const reference = positionOf(appSource, 'Counter.view');
      const declaration = positionOf(
        counterSource,
        'view = Submodel.defineView',
      );
      const definition = await lsp.request<Location[]>(
        'textDocument/definition',
        {
          textDocument,
          position: {
            ...reference,
            character: reference.character + 'Counter.'.length,
          },
        },
      );
      expect(definition).toEqual([
        {
          uri: pathToFileURL(counterFile).href,
          range: {
            start: declaration,
            end: {
              ...declaration,
              character: declaration.character + 'view'.length,
            },
          },
        },
      ]);

      const invalidSource = appSource.replace("'Left counter'", '123');
      expect(invalidSource).not.toBe(appSource);
      await lsp.connection.sendNotification('textDocument/didChange', {
        textDocument: { uri, version: 2 },
        contentChanges: [
          { range: rangeOf(appSource, "'Left counter'"), text: '123' },
        ],
      });
      const invalid = await lsp.request<DiagnosticReport>(
        'textDocument/diagnostic',
        { textDocument, identifier: 'typescript' },
      );
      expect(invalid.items.filter((item) => item.severity === 1)).toEqual([
        expect.objectContaining({
          code: 2769,
          range: rangeOf(invalidSource, 'jsx.Submodel'),
          message: expect.stringContaining('No overload matches this call.'),
        }),
      ]);

      await lsp.connection.sendNotification('textDocument/didChange', {
        textDocument: { uri, version: 3 },
        contentChanges: [{ text: appSource }],
      });
      const restored = await lsp.request<DiagnosticReport>(
        'textDocument/diagnostic',
        { textDocument, identifier: 'typescript' },
      );
      expect(restored.items.filter((item) => item.severity === 1)).toEqual([]);
    } finally {
      await lsp.dispose();
    }
  }, 30_000);
});
