import { spawnSync } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { transformGtsx } from './content-mapper.js';

const require = createRequire(import.meta.url);
const packageDirectory = resolve(import.meta.dirname, '../..');
const temporaryProjects: string[] = [];
let nativeCompiler: string;

function runCompiler(compiler: string, directory: string, args: string[]) {
  const result = spawnSync(process.execPath, [compiler, ...args], {
    cwd: directory,
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (result.error) throw result.error;
  return { status: result.status, output: result.stdout + result.stderr };
}

interface ProjectOptions {
  mapperOptions?: Record<string, unknown>;
  compilerOptions?: Record<string, unknown>;
  include?: string[];
}

async function project(
  files: Record<string, string>,
  options: ProjectOptions = {},
) {
  const directory = await mkdtemp(join(tmpdir(), 'gtsx-integration-'));
  temporaryProjects.push(directory);
  await mkdir(join(directory, 'node_modules/@causeeffect'), {
    recursive: true,
  });
  await symlink(
    packageDirectory,
    join(directory, 'node_modules/@causeeffect/jsx-content-mapper'),
    'dir',
  );
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({ type: 'module' }),
  );
  await writeFile(
    join(directory, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'es2022',
        lib: ['es2022', 'dom', 'esnext.disposable'],
        module: 'esnext',
        moduleResolution: 'bundler',
        strict: true,
        declaration: true,
        declarationMap: true,
        outDir: 'out',
        noEmitOnError: true,
        types: [],
        ...options.compilerOptions,
      },
      contentMappers: [
        {
          package: '@causeeffect/jsx-content-mapper',
          extensions: ['.gtsx'],
          ...(options.mapperOptions ? { options: options.mapperOptions } : {}),
        },
      ],
      ...(options.include
        ? { include: options.include }
        : { files: ['main.gtsx'] }),
    }),
  );
  await Promise.all(
    Object.entries(files).map(([name, text]) =>
      writeFile(join(directory, name), text),
    ),
  );
  return directory;
}

function compile(directory: string, externalCode = true) {
  return runCompiler(nativeCompiler, directory, [
    '-p',
    'tsconfig.json',
    '--pretty',
    'false',
    ...(externalCode ? ['--runExternalCode'] : []),
  ]);
}

describe('TypeScript 7.1 content mapper integration', () => {
  beforeAll(async () => {
    const manifestPath = require.resolve('typescript-next/package.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      version: string;
      bin: { tsc: string };
    };
    expect(manifest.version).toMatch(/^7\.1\./);
    nativeCompiler = join(dirname(manifestPath), manifest.bin.tsc);
    const build = runCompiler(
      require.resolve('typescript/bin/tsc'),
      packageDirectory,
      ['-p', 'tsconfig.lib.json'],
    );
    expect(build.status, build.output).toBe(0);
  }, 30_000);

  afterAll(async () => {
    await Promise.all(
      temporaryProjects.map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  it('preserves inferred and annotated generator generics, JSX type arguments, and .gtsx imports', async () => {
    const directory = await project({
      'component.gtsx': `export function* Imported<T>({ value }: { value: T }) {
  yield value;
  return <p>Imported</p>;
}
`,
      'main.gtsx': `import type { JSX } from '@causeeffect/jsx-content-mapper/runtime';
import { Imported } from './component.gtsx';
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
function* Test() {
  yield 123;
  return <p>Hello</p>;
}
export const Result = <Test />;
type Inferred = Assert<Equal<typeof Result, JSX.GeneratorElement<number, JSX.GeneratorElement<never, never, never>, unknown>>>;
function* Annotated(): Generator<'event', JSX.GeneratorElement<never, never, never>, boolean> {
  yield 'event';
  return <p />;
}
export const annotated = <Annotated />;
type Explicit = Assert<Equal<typeof annotated, JSX.GeneratorElement<'event', JSX.GeneratorElement<never, never, never>, boolean>>>;
export const generic = <Imported<number> value={123} />;
type Generic = Assert<Equal<typeof generic, JSX.GeneratorElement<number, JSX.GeneratorElement<never, never, never>, unknown>>>;
function* Callback({ onValue }: { onValue: (value: number) => number }) {
  yield onValue(1);
  return <p />;
}
export const callback = <Callback onValue={value => value + 1} />;
type Contextual = Assert<Equal<typeof callback, JSX.GeneratorElement<number, JSX.GeneratorElement<never, never, never>, unknown>>>;
const components = { Imported };
export const member = <components.Imported {...{ value: 'event' }} />;
type Member = Assert<Equal<typeof member, JSX.GeneratorElement<string, JSX.GeneratorElement<never, never, never>, unknown>>>;
async function* Async(): AsyncGenerator<number, JSX.GeneratorElement<never, never, never>, string> {
  yield 123;
  return <p />;
}
export const asynchronous = <Async />;
type AsyncChannels = Assert<Equal<typeof asynchronous, JSX.GeneratorElement<number, JSX.GeneratorElement<never, never, never>, string>>>;
`,
    });
    const result = compile(directory);
    expect(result.status, result.output).toBe(0);
    const outputs = await readdir(join(directory, 'out'));
    const declarationName = 'main.d.gtsx.ts';
    expect(outputs).toContain(declarationName);
    const declaration = await readFile(
      join(directory, 'out', declarationName),
      'utf8',
    );
    expect(declaration).toMatch(/Generator(?:Element)?<number,/);
    expect(declaration).toContain('GeneratorElement<never, never, never>');
    expect(declaration).toContain('unknown>');
    expect(declaration).toContain('boolean>');
    const mapName = 'main.d.gtsx.ts.map';
    expect(outputs).toContain(mapName);
    const map = JSON.parse(
      await readFile(join(directory, 'out', mapName), 'utf8'),
    ) as { sources: string[] };
    expect(map.sources.some((name) => name.endsWith('main.gtsx'))).toBe(true);
  });

  it('reports component prop errors at the original .gtsx attribute after Unicode text', async () => {
    const directory = await project({
      'main.gtsx': `function* Counter({ count }: { count: number }) {
  yield count;
  return <p />;
}
const emoji = '🦊'; export const invalid = <Counter count="wrong" />;
`,
    });
    const result = compile(directory);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('main.gtsx(5,53): error TS2322:');
    expect(result.output).toContain(
      "Type 'string' is not assignable to type 'number'",
    );
    expect(result.output).not.toContain('.gtsx.ts');
  });

  it('accepts defaulted props, no-argument generic defaults, explicit type arguments, and zero-argument overloads', async () => {
    const directory = await project({
      'main.gtsx': `import type { JSX } from '@causeeffect/jsx-content-mapper/runtime';
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type Leaf = JSX.GeneratorElement<never, never, never>;
function* Optional({ label = 'optional' }: { label?: string } = {}) {
  yield label;
  return <p />;
}
export const optional = <Optional />;
type OptionalChannels = Assert<Equal<typeof optional, JSX.GeneratorElement<string, Leaf, unknown>>>;
function* Generic<T = string>(): Generator<T, Leaf, never> {
  return <p />;
}
export const defaultGeneric = <Generic />;
type DefaultChannels = Assert<Equal<typeof defaultGeneric, JSX.GeneratorElement<string, Leaf, never>>>;
export const explicitGeneric = <Generic<number> />;
type ExplicitChannels = Assert<Equal<typeof explicitGeneric, JSX.GeneratorElement<number, Leaf, never>>>;
function Overloaded(): Generator<'zero', Leaf, boolean>;
function Overloaded(props: { id: string }): Generator<'props', Leaf, string>;
function* Overloaded(props?: { id: string }): Generator<'zero' | 'props', Leaf, boolean | string> {
  yield props ? 'props' : 'zero';
  return <p />;
}
export const overloaded = <Overloaded />;
type OverloadChannels = Assert<Equal<typeof overloaded, JSX.GeneratorElement<'zero', Leaf, boolean>>>;
`,
    });
    const result = compile(directory);
    expect(result.status, result.output).toBe(0);
  });

  it('reports missing props arguments at the original component opening tags', async () => {
    const directory = await project({
      'main.gtsx': `function* Required({ count }: { count: number }) {
  yield count;
  return <p />;
}
function* OptionalObject({ label }: { label?: string }) {
  yield label;
  return <p />;
}
export const invalidRequired = <Required />;
export const invalidOptionalObject = <OptionalObject />;
`,
    });
    const result = compile(directory);
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/main\.gtsx\(9,\d+\): error TS2554:/);
    expect(result.output).toMatch(/main\.gtsx\(10,\d+\): error TS2554:/);
    expect(result.output).toContain('Expected 1 arguments, but got 0.');
    expect(result.output).not.toContain('no corresponding location');
  });

  it('discovers .gtsx files through tsconfig include patterns', async () => {
    const directory = await project(
      {
        'discovered.gtsx': 'export const discovered = <p>Discovered</p>;',
      },
      { include: ['*.gtsx'] },
    );
    const result = compile(directory);
    expect(result.status, result.output).toBe(0);
    expect(await readdir(join(directory, 'out'))).toContain(
      'discovered.d.gtsx.ts',
    );
  });

  it('uses a configured runtime module when lowering JSX', async () => {
    const directory = await project(
      {
        'custom-runtime.ts': `export { createComponent, Fragment } from '@causeeffect/jsx-content-mapper/runtime';
export function createElement(_type: string | symbol, _props: Readonly<Record<string, unknown>>) {
  return 42 as const;
}
`,
        'main.gtsx': `export const content = <p>Custom</p>;
const expected: 42 = content;
`,
      },
      { mapperOptions: { runtimeModule: './custom-runtime.js' } },
    );
    const result = compile(directory);
    expect(result.status, result.output).toBe(0);
    const declaration = await readFile(
      join(directory, 'out/main.d.gtsx.ts'),
      'utf8',
    );
    expect(declaration).toContain('content: 42');
  });

  it('uses standard classic factories and fragment values from compiler options', async () => {
    const directory = await project(
      {
        'main.gtsx': `const Fragment = Symbol('fragment');
const factory = {
  createElement(tag: string | typeof Fragment, props: { count?: number } | null, ...children: ReadonlyArray<42 | string>) {
    return 42 as const;
  },
  Fragment: Fragment as typeof Fragment,
};
export const content = <><p count={123}>Hello</p></>;
const expected: 42 = content;
`,
      },
      {
        mapperOptions: { jsxRuntime: 'classic' },
        compilerOptions: {
          jsxFactory: 'factory.createElement',
          jsxFragmentFactory: 'factory.Fragment',
        },
      },
    );
    const result = compile(directory);
    expect(result.status, result.output).toBe(0);
    const declaration = await readFile(
      join(directory, 'out/main.d.gtsx.ts'),
      'utf8',
    );
    expect(declaration).toContain('content: 42');
  });

  it('maps classic factory prop type errors to the original JSX attribute', async () => {
    const directory = await project(
      {
        'main.gtsx': `const jsx = {
  createElement(tag: string, props: { count: number }) { return tag; },
};
export const invalid = <p count="wrong" />;
`,
      },
      {
        mapperOptions: {
          jsxRuntime: 'classic',
          jsxFactory: 'jsx.createElement',
        },
      },
    );
    const result = compile(directory);
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/main\.gtsx\(4,\d+\): error TS2322:/);
    expect(result.output).toContain(
      "Type 'string' is not assignable to type 'number'",
    );
  });

  it.each([
    { jsxRuntime: 'invalid' },
    { jsxRuntime: 'classic', jsxFactory: 'factory()' },
  ])(
    'reports invalid classic options %j through mapper configuration diagnostics',
    async (mapperOptions) => {
      const directory = await project(
        { 'main.gtsx': 'export {};' },
        { mapperOptions },
      );
      const result = compile(directory);
      expect(result.status).not.toBe(0);
      expect(result.output).toMatch(/tsconfig\.json\(1,\d+\): error gtsx[45]:/);
      expect(result.output).not.toContain('Content mapper process exited');
    },
  );

  it.each([123, '', '   '])(
    'reports an invalid runtimeModule option %j at tsconfig.json',
    async (runtimeModule) => {
      const directory = await project(
        { 'main.gtsx': 'export {};' },
        {
          mapperOptions: { runtimeModule },
        },
      );
      const result = compile(directory);
      expect(result.status).not.toBe(0);
      expect(result.output).toMatch(/tsconfig\.json\(1,\d+\): error gtsx3:/);
      expect(result.output).toContain(
        'runtimeModule must be a nonempty module specifier.',
      );
      expect(result.output).not.toContain('Content mapper process exited');
    },
  );

  it('preserves Effect v4 yielded operations, errors, and required services', async () => {
    const directory = await project({
      'main.gtsx': `import { Effect } from 'effect';
import type { JSX } from '@causeeffect/jsx-content-mapper/runtime';
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
interface Failure { readonly _tag: 'Failure' }
interface Requirement { readonly service: 'requirement' }
declare const operation: Effect.Effect<string, Failure, Requirement>;
function* View() {
  const result = yield* operation;
  return <p>{result}</p>;
}
export const content = <View />;
type GeneratorChannels<G> = G extends Generator<infer Y, infer R, infer N> ? [Y, R, N] : never;
type ElementChannels<E> = E extends JSX.GeneratorElement<infer Y, infer R, infer N> ? [Y, R, N] : never;
type Preserved = Assert<Equal<GeneratorChannels<ReturnType<typeof View>>, ElementChannels<typeof content>>>;
type Yielded = ElementChannels<typeof content>[0];
type Operation = Assert<Equal<Yielded, Effect.Effect<string, Failure, Requirement>>>;
type Errors = Assert<Equal<Effect.Error<Yielded>, Failure>>;
type Services = Assert<Equal<Effect.Services<Yielded>, Requirement>>;
export const program = Effect.gen(View);
type Program = Assert<Equal<typeof program, Effect.Effect<JSX.GeneratorElement<never, never, never>, Failure, Requirement>>>;
`,
    });
    await symlink(
      dirname(require.resolve('effect/package.json')),
      join(directory, 'node_modules/effect'),
      'dir',
    );
    const result = compile(directory);
    expect(result.status, result.output).toBe(0);
    const declaration = await readFile(
      join(directory, 'out/main.d.gtsx.ts'),
      'utf8',
    );
    expect(declaration).toContain(
      'Effect.Effect<string, Failure, Requirement>',
    );
  });

  it('reports JSX parser errors through the mapper without crashing the compiler', async () => {
    const directory = await project({
      'main.gtsx': 'export const broken = <p>Oops</div>;',
    });
    const result = compile(directory);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('main.gtsx');
    expect(result.output).toMatch(/error /);
    expect(result.output).toMatch(/closing tag|JSX|jsx/i);
    expect(result.output).not.toContain('Content mapper process exited');
  });

  it('requires the compiler opt-in before starting an external content mapper', async () => {
    const directory = await project({
      'main.gtsx': 'export const content = <p>Hello</p>;',
    });
    const result = compile(directory, false);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('runExternalCode');
  });

  it('executes compiled virtual TypeScript with lazy generator bodies and matching overload branches', async () => {
    const source = `import type { JSX } from '@causeeffect/jsx-content-mapper/runtime';
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
export let evaluations = 0;
function* Test() {
  evaluations++;
  yield 123;
  return <p>Hello</p>;
}
export const Result = <Test />;
export const branches: string[] = [];
function Overloaded(): Generator<'zero', 'zero-return', unknown>;
function Overloaded(props: { id: string }): Generator<'props', 'props-return', unknown>;
function* Overloaded(props?: { id: string }): Generator<'zero' | 'props', 'zero-return' | 'props-return', unknown> {
  const noProps = arguments.length === 0;
  branches.push(noProps ? 'zero' : 'props');
  if (noProps) {
    yield 'zero';
    return 'zero-return';
  }
  yield 'props';
  return 'props-return';
}
export const zero = <Overloaded />;
type ZeroChannels = Assert<Equal<typeof zero, JSX.GeneratorElement<'zero', 'zero-return', unknown>>>;
export const props = <Overloaded id="mapped" />;
type PropsChannels = Assert<Equal<typeof props, JSX.GeneratorElement<'props', 'props-return', unknown>>>;
`;
    const directory = await project({ 'main.gtsx': source });
    const result = compile(directory);
    expect(result.status, result.output).toBe(0);
    // Native content mappers emit declarations only. A build tool can compile
    // the same virtual TypeScript to JavaScript separately.
    const config = JSON.parse(
      await readFile(join(directory, 'tsconfig.json'), 'utf8'),
    ) as {
      files: string[];
      contentMappers?: unknown;
    };
    config.files = ['main.ts'];
    delete config.contentMappers;
    await Promise.all([
      writeFile(join(directory, 'main.ts'), transformGtsx(source).text),
      writeFile(join(directory, 'tsconfig.json'), JSON.stringify(config)),
    ]);
    const emitted = compile(directory, false);
    expect(emitted.status, emitted.output).toBe(0);
    const executed = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      import { strict as assert } from 'node:assert';
      import * as module from './out/main.js';
      assert.equal(module.evaluations, 0);
      assert.equal(module.Result.kind, 'component');
      const iterator = module.Result.value;
      assert.equal(module.evaluations, 0);
      assert.deepEqual(iterator.next(), { value: 123, done: false });
      assert.equal(module.evaluations, 1);
      const completed = iterator.next();
      assert.equal(completed.done, true);
      assert.equal(completed.value.kind, 'intrinsic');
      assert.equal(completed.value.type, 'p');
      assert.equal(completed.value.props.children, 'Hello');
      assert.deepEqual(module.branches, []);
      assert.deepEqual(module.zero.value.next(), { value: 'zero', done: false });
      assert.deepEqual(module.zero.value.next(), { value: 'zero-return', done: true });
      assert.deepEqual(module.props.value.next(), { value: 'props', done: false });
      assert.deepEqual(module.props.value.next(), { value: 'props-return', done: true });
      assert.deepEqual(module.branches, ['zero', 'props']);
    `,
      ],
      { cwd: directory, encoding: 'utf8', timeout: 30_000 },
    );
    if (executed.error) throw executed.error;
    expect(executed.status, executed.stdout + executed.stderr).toBe(0);
  });
});
