import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { allMappings, fromMap } from '@jridgewell/gen-mapping';
import { afterAll, describe, expect, it } from 'vitest';
import {
  build,
  createServer,
  optimizeDeps,
  resolveConfig,
  type Rolldown,
} from 'vite';
import gtsx from './vite.js';

const temporaryProjects: string[] = [];
const classicOptions = {
  jsxRuntime: 'classic' as const,
  jsxFactory: 'jsx.createElement',
  jsxFragmentFactory: 'jsx.Fragment',
};

async function project(files: Record<string, string>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'gtsx-vite-')));
  temporaryProjects.push(root);
  await Promise.all(
    Object.entries(files).map(async ([name, content]) => {
      const file = join(root, name);
      await mkdir(resolve(file, '..'), { recursive: true });
      await writeFile(file, content);
    }),
  );
  return root;
}

const fixture = {
  'runtime.ts': `export const Fragment = 'fragment';
export function createElement(type: string | ((props: object) => unknown), props: object | null, ...children: unknown[]) {
  return typeof type === 'function'
    ? type({ ...props, children })
    : { type, props, children };
}
`,
  'Greeting.gtsx': `import * as jsx from './runtime';
export function Greeting({ label }: { label: string }) {
  return <span>{label}</span>;
}
`,
  'main.gtsx': `import * as jsx from './runtime';
import { Greeting } from './Greeting.gtsx';
type Label = string;
const label: Label = 'Hello';
export const result = <main id="app"><Greeting label={label} /><>{'!'}</></main>;
`,
};

afterAll(async () => {
  await Promise.all(
    temporaryProjects.map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('gtsx Vite plugin', () => {
  it('rejects invalid runtime options when the plugin is configured', () => {
    expect(() => gtsx({ jsxFactory: 'jsx.createElement' })).toThrow(
      'requires jsxRuntime: "classic"',
    );
  });

  it('builds .gtsx imports, erases TypeScript, and runs a classic JSX factory', async () => {
    const root = await project(fixture);
    const result = await build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [gtsx(classicOptions)],
      build: {
        lib: { entry: join(root, 'main.gtsx'), formats: ['es'] },
        minify: false,
        write: false,
        sourcemap: true,
      },
    });
    const bundles = Array.isArray(result) ? result : [result];
    const entry = bundles
      .flatMap((bundle) => ('output' in bundle ? bundle.output : []))
      .find(
        (output): output is Rolldown.OutputChunk =>
          output.type === 'chunk' && output.isEntry,
      );
    expect(entry).toBeDefined();
    if (!entry) throw new Error('Vite did not emit an entry chunk.');
    expect(entry?.code).not.toContain('type Label');
    const module = (await import(
      `data:text/javascript;base64,${Buffer.from(entry.code).toString('base64')}`
    )) as { result: unknown };
    expect(module.result).toEqual({
      type: 'main',
      props: { id: 'app' },
      children: [
        { type: 'span', props: null, children: ['Hello'] },
        { type: 'fragment', props: null, children: ['!'] },
      ],
    });
    expect(entry?.map?.sources).toEqual(
      expect.arrayContaining([expect.stringMatching(/(?:^|\/)main\.gtsx$/)]),
    );
    expect(entry?.map?.sourcesContent).toContain(fixture['main.gtsx']);
  });

  it('transforms dev requests, analyzes .gtsx imports, and resolves extensionless components', async () => {
    const root = await project({
      ...fixture,
      'main.gtsx': fixture['main.gtsx'].replace(
        './Greeting.gtsx',
        './Greeting',
      ),
    });
    const server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [gtsx(classicOptions)],
      server: { middlewareMode: true, hmr: false },
      optimizeDeps: { noDiscovery: true },
    });
    try {
      const result = await server.transformRequest('/main.gtsx?import&t=123');
      expect(result?.code).toContain('jsx.createElement');
      expect(result?.code).toContain('/Greeting.gtsx?import');
      expect(result?.code).not.toContain('const label:');
      const greeting = await server.transformRequest('/Greeting.gtsx?import');
      expect(greeting?.code).toContain('jsx.createElement("span"');
      const map = result?.map;
      expect(map && 'sources' in map ? map.sources : []).toContain('main.gtsx');
      expect(
        map && 'sourcesContent' in map ? map.sourcesContent : [],
      ).toContain(
        fixture['main.gtsx'].replace('./Greeting.gtsx', './Greeting'),
      );
    } finally {
      await server.close();
    }
  });

  it('discovers and optimizes dependencies imported from .gtsx entries', async () => {
    const root = await project({
      ...fixture,
      'main.gtsx': `import * as jsx from './runtime';
import { label } from 'example-dependency';
export const result = <p>{label}</p>;
`,
      'node_modules/example-dependency/package.json': JSON.stringify({
        name: 'example-dependency',
        version: '1.0.0',
        type: 'module',
        exports: './index.js',
      }),
      'node_modules/example-dependency/index.js':
        "export const label = 'Hello';",
    });
    const config = await resolveConfig(
      {
        root,
        configFile: false,
        logLevel: 'silent',
        plugins: [gtsx(classicOptions)],
        optimizeDeps: { entries: ['main.gtsx'] },
      },
      'serve',
    );
    const metadata = await optimizeDeps(config);
    expect(metadata.optimized['example-dependency']).toMatchObject({
      src: join(root, 'node_modules/example-dependency/index.js'),
    });
  });

  it('leaves raw and URL requests to Vite and ignores ordinary TypeScript files', async () => {
    const root = await project({
      'view.gtsx': 'export const view = <main />;',
      'main.ts': 'export const value: number = 123;',
    });
    const server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [gtsx(classicOptions)],
      server: { middlewareMode: true, hmr: false },
      optimizeDeps: { noDiscovery: true },
    });
    try {
      const raw = await server.transformRequest('/view.gtsx?raw');
      expect(raw?.code).toContain(
        'export default "export const view = <main />;"',
      );
      const url = await server.transformRequest('/view.gtsx?url');
      expect(url?.code).toContain('/view.gtsx');
      expect(url?.code).not.toContain('createElement');
      const typescript = await server.transformRequest('/main.ts');
      expect(typescript?.code).toContain('123');
      expect(typescript?.code).not.toContain('__gtsx');
    } finally {
      await server.close();
    }
  });

  it('maps emitted expressions back to UTF-16 columns in original CRLF source', async () => {
    const source =
      "const title = '🦊';\r\nexport const view = <p title={title}>{title}</p>;";
    const root = await project({ 'main.gtsx': source });
    const server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [gtsx(classicOptions)],
      server: { middlewareMode: true, hmr: false },
      optimizeDeps: { noDiscovery: true },
    });
    try {
      const result = await server.transformRequest('/main.gtsx?import');
      expect(result?.map).toBeDefined();
      const expectedColumn =
        source.lastIndexOf('{title}') + 1 - (source.indexOf('\n') + 1);
      expect(allMappings(fromMap(JSON.stringify(result?.map)))).toContainEqual(
        expect.objectContaining({
          source: 'main.gtsx',
          original: { line: 2, column: expectedColumn },
        }),
      );
    } finally {
      await server.close();
    }
  });

  it('reports invalid JSX at its original .gtsx location', async () => {
    const root = await project({ 'main.gtsx': 'export const view = <main>;' });
    const server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [gtsx(classicOptions)],
      server: { middlewareMode: true, hmr: false },
      optimizeDeps: { noDiscovery: true },
    });
    try {
      await expect(
        server.transformRequest('/main.gtsx?import'),
      ).rejects.toMatchObject({
        plugin: '@causeeffect/gtsx',
        id: join(root, 'main.gtsx'),
        loc: { line: 1 },
        message: expect.stringContaining('Unterminated JSX'),
      });
    } finally {
      await server.close();
    }
  });

  it('builds with the default generator runtime', async () => {
    const root = await project({
      'main.gtsx': `function* Test(): Generator<number, unknown, unknown> {
  yield 123;
  return <p>Hello</p>;
}
export const result = <Test />;
`,
    });
    const result = await build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [
        gtsx({ runtimeModule: resolve(import.meta.dirname, 'runtime.ts') }),
      ],
      build: {
        lib: { entry: join(root, 'main.gtsx'), formats: ['es'] },
        write: false,
      },
    });
    const bundles = Array.isArray(result) ? result : [result];
    const entry = bundles
      .flatMap((bundle) => ('output' in bundle ? bundle.output : []))
      .find(
        (output): output is Rolldown.OutputChunk =>
          output.type === 'chunk' && output.isEntry,
      );
    if (!entry) throw new Error('Vite did not emit an entry chunk.');
    const module = (await import(
      `data:text/javascript;base64,${Buffer.from(entry.code).toString('base64')}`
    )) as {
      result: { kind: 'component'; value: Generator<number, unknown, unknown> };
    };
    expect(module.result.kind).toBe('component');
    expect(module.result.value.next()).toEqual({ done: false, value: 123 });
    expect(module.result.value.next()).toEqual({
      done: true,
      value: { kind: 'intrinsic', type: 'p', props: { children: 'Hello' } },
    });
  });
});
