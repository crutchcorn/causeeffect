import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const exampleDirectory = resolve(import.meta.dirname, '..');
const temporaryProjects: string[] = [];
let compiler: string;

const fixturePrelude = `import { Submodel } from 'foldkit';
import type { HtmlBuilder } from 'foldkit/html';
import { createJsx } from '@causeeffect/foldkit-jsx';
type ParentMessage = { readonly _tag: 'Parent'; readonly value: number };
type ChildMessage = { readonly _tag: 'Child' };
type ChildModel = { readonly count: number };
declare const h: HtmlBuilder<ParentMessage>;
const jsx = createJsx(h);
const childMessage: ChildMessage = { _tag: 'Child' };
const wrap = (_message: ChildMessage): ParentMessage => ({ _tag: 'Parent', value: 1 });
const childView = Submodel.defineView<ChildModel, ChildMessage, { label: string }>(
  (model, inputs, childH) => {
    const childJsx = createJsx(childH);
    return childJsx.createElement('button', { OnClick: childMessage }, inputs.label, model.count);
  },
);
`;

async function compile(source: string) {
  const directory = await mkdtemp(join(tmpdir(), 'foldkit-gtsx-types-'));
  temporaryProjects.push(directory);
  await symlink(
    join(exampleDirectory, 'node_modules'),
    join(directory, 'node_modules'),
    'dir',
  );
  await Promise.all([
    writeFile(
      join(directory, 'package.json'),
      JSON.stringify({ type: 'module' }),
    ),
    writeFile(join(directory, 'main.gtsx'), source),
    writeFile(
      join(directory, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'es2022',
          lib: ['es2022', 'dom', 'esnext.disposable'],
          module: 'esnext',
          moduleResolution: 'bundler',
          strict: true,
          exactOptionalPropertyTypes: true,
          skipLibCheck: true,
          types: [],
        },
        contentMappers: [
          {
            package: '@causeeffect/jsx-content-mapper',
            extensions: ['.gtsx'],
            options: {
              jsxRuntime: 'classic',
              jsxFactory: 'jsx.createElement',
              jsxFragmentFactory: 'jsx.Fragment',
            },
          },
        ],
        files: ['main.gtsx'],
      }),
    ),
  ]);
  const result = spawnSync(
    process.execPath,
    [
      compiler,
      '-p',
      'tsconfig.json',
      '--pretty',
      'false',
      '--runExternalCode',
      '--noEmit',
    ],
    {
      cwd: directory,
      encoding: 'utf8',
      timeout: 30_000,
    },
  );
  if (result.error) throw result.error;
  return { status: result.status, output: result.stdout + result.stderr };
}

function expectDiagnostic(output: string, source: string, marker: string) {
  const line =
    source.split('\n').findIndex((text) => text.includes(marker)) + 1;
  expect(line).toBeGreaterThan(0);
  expect(output).toMatch(
    new RegExp(`main\\.gtsx\\(${line},\\d+\\): error TS\\d+:`),
  );
}

describe('native TypeScript 7.1 Foldkit JSX diagnostics', () => {
  beforeAll(async () => {
    const manifestPath = require.resolve('typescript-next/package.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      version: string;
      bin: { tsc: string };
    };
    expect(manifest.version).toMatch(/^7\.1\./);
    compiler = join(dirname(manifestPath), manifest.bin.tsc);
  });

  afterAll(async () => {
    await Promise.all(
      temporaryProjects.map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  it('reports a child Message used as a root event at the original attribute', async () => {
    const source =
      fixturePrelude +
      `
export const valid = <button OnClick={wrap(childMessage)}>Parent event</button>;
export const invalidEvent = <button OnClick={childMessage}>Child event</button>;
`;
    const result = await compile(source);
    expect(result.status).not.toBe(0);
    expectDiagnostic(result.output, source, 'invalidEvent');
    expect(result.output).toContain('error TS2769:');
    expect(result.output).not.toContain('.gtsx.ts');
    expect(result.output).not.toContain('error TS2307:');
  }, 30_000);

  it('contextually types direct input callbacks and rejects invalid attributes', async () => {
    const source =
      fixturePrelude +
      `
export const validInput = <input Value="Draft" Checked={true} Class="field" AriaLabel="Draft" attributes={[h.DataAttribute('state', 'edited')]} OnInput={(value) => {
  const text: string = value;
  // @ts-expect-error The contextual parameter is string, not any.
  const number: number = value;
  return { _tag: 'Parent', value: text.length };
}} />;
export const validOmitted = <input Class={undefined} Value={undefined} Checked={false} />;
export const wrongMessage = <input OnInput={(value) => ({ _tag: 'Child' })} />;
export const wrongParameter = <input OnInput={(value: number) => ({ _tag: 'Parent', value })} />;
export const wrongClick = <button OnClick={() => ({ _tag: 'Parent', value: 1 })} />;
export const wrongClass = <div Class={123} />;
export const wrongChecked = <input Checked="yes" />;
export const wrongTextarea = <textarea InnerHTML="Draft" />;
export const wrongCasing = <button onClick={wrap(childMessage)} />;
`;
    const result = await compile(source);
    expect(result.status).not.toBe(0);
    for (const marker of [
      'wrongMessage',
      'wrongParameter',
      'wrongClick',
      'wrongClass',
      'wrongChecked',
      'wrongTextarea',
      'wrongCasing',
    ]) {
      expectDiagnostic(result.output, source, marker);
    }
    expect(result.output).not.toContain(
      "Parameter 'value' implicitly has an 'any' type",
    );
    expect(result.output).not.toContain('error TS2578:');
    expect(result.output).not.toContain('.gtsx.ts');
    expect(result.output).not.toContain('error TS2307:');
    for (const [index, line] of source.split('\n').entries()) {
      if (
        line.includes('validInput') ||
        line.includes('validOmitted') ||
        line.includes('const text: string')
      ) {
        expect(result.output).not.toContain(`main.gtsx(${index + 1},`);
      }
    }
  }, 30_000);

  it('checks branded Submodel views, models, inputs, and parent message wrappers', async () => {
    const source =
      fixturePrelude +
      `
export const valid = <jsx.Submodel slotId="valid" model={{ count: 1 }} view={childView} viewInputs={{ label: 'Child' }} toParentMessage={wrap} />;
export const wrongModel = <jsx.Submodel slotId="model" model={{ count: 'wrong' }} view={childView} viewInputs={{ label: 'Child' }} toParentMessage={wrap} />;
export const missingModel = <jsx.Submodel slotId="missing-model" view={childView} viewInputs={{ label: 'Child' }} toParentMessage={wrap} />;
export const missingInputs = <jsx.Submodel slotId="missing-inputs" model={{ count: 1 }} view={childView} toParentMessage={wrap} />;
export const wrongInputs = <jsx.Submodel slotId="inputs" model={{ count: 1 }} view={childView} viewInputs={{ label: 123 }} toParentMessage={wrap} />;
export const wrongWrapper = <jsx.Submodel slotId="wrapper" model={{ count: 1 }} view={childView} viewInputs={{ label: 'Child' }} toParentMessage={(message: ChildMessage) => message} />;
export const missingWrapper = <jsx.Submodel slotId="missing-wrapper" model={{ count: 1 }} view={childView} viewInputs={{ label: 'Child' }} />;
const unbrandedView = (model: ChildModel, childH: HtmlBuilder<ChildMessage>) => childH.p([], [String(model.count)]);
export const unbranded = <jsx.Submodel slotId="unbranded" model={{ count: 1 }} view={unbrandedView} toParentMessage={wrap} />;
`;
    const result = await compile(source);
    expect(result.status).not.toBe(0);
    for (const marker of [
      'wrongModel',
      'missingModel',
      'missingInputs',
      'wrongInputs',
      'wrongWrapper',
      'missingWrapper',
      'export const unbranded',
    ]) {
      expectDiagnostic(result.output, source, marker);
    }
    expect(result.output).not.toContain('.gtsx.ts');
    expect(result.output).not.toContain('error TS2307:');
    const validLine =
      source
        .split('\n')
        .findIndex((text) => text.includes('export const valid')) + 1;
    expect(result.output).not.toContain(`main.gtsx(${validLine},`);
  }, 30_000);

  it('checks ordinary component required props and typed positional children', async () => {
    const source =
      fixturePrelude +
      `
function Label({ label, children }: { label: string; children?: ReadonlyArray<number> }) {
  return h.p([], [label, ...(children ?? []).map(String)]);
}
export const valid = <Label label="Numbers">{1}{2}</Label>;
export const missingProps = <Label />;
export const wrongChildren = <Label label="Numbers">wrong</Label>;
`;
    const result = await compile(source);
    expect(result.status).not.toBe(0);
    expectDiagnostic(result.output, source, 'missingProps');
    expectDiagnostic(result.output, source, 'wrongChildren');
    expect(result.output).toContain(
      "Argument of type 'string' is not assignable to parameter of type 'number'",
    );
    expect(result.output).not.toContain('.gtsx.ts');
    expect(result.output).not.toContain('error TS2307:');
  }, 30_000);
});
