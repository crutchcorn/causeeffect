import { parse } from '@babel/parser';
import {
  SpanMapKind,
  type PositionEncoding,
  type TransformResult,
} from 'ts-content-mapper';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import * as runtime from '../runtime.js';
import { transformGtsx } from './content-mapper.js';

function runContent<Result>(source: string): Result {
  const transformed = transformGtsx(source);
  expect(transformed.diagnostics).toBeUndefined();
  const compiled = ts.transpileModule(transformed.text, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
    reportDiagnostics: true,
  });
  expect(compiled.diagnostics).toEqual([]);
  const exports = {};
  const require = (specifier: string) => {
    expect(specifier).toBe('@causeeffect/jsx-content-mapper/runtime');
    return runtime;
  };
  new Function('require', 'exports', compiled.outputText)(require, exports);
  return exports as Result;
}

function offset(
  text: string,
  index: number,
  encoding: PositionEncoding,
): number {
  return encoding === 'utf-8'
    ? Buffer.byteLength(text.slice(0, index), 'utf8')
    : index;
}

function originalOffset(
  result: TransformResult,
  virtualPosition: number,
): number | undefined {
  const mapping = result.mappings?.find(
    ([start, length, , , kind]) =>
      kind === SpanMapKind.Verbatim &&
      virtualPosition >= start &&
      virtualPosition < start + length,
  );
  return mapping ? mapping[2] + virtualPosition - mapping[0] : undefined;
}

describe('transformGtsx', () => {
  it('keeps a JSX-free TypeScript file and its mapping verbatim', () => {
    const source = 'const café: string = "🦊";\nexport { café };\n';
    const result = transformGtsx(source);
    expect(result.extension).toBe('.ts');
    expect(result.text).toBe(source);
    expect(result.mappings).toEqual([
      [0, source.length, 0, source.length, SpanMapKind.Verbatim],
    ]);
  });

  it('lowers nested JSX in expression containers, attribute values and spreads', () => {
    const { result } = runContent<{ result: unknown }>(`
      const result = <main
        {...{ before: <i>first</i>, id: 'old' }}
        id="new"
        after={<b>last</b>}
      >{true ? <span>{[<em>deep</em>]}</span> : null}</main>;
      export { result };
    `);
    expect(result).toEqual({
      kind: 'intrinsic',
      type: 'main',
      props: {
        before: { kind: 'intrinsic', type: 'i', props: { children: 'first' } },
        id: 'new',
        after: { kind: 'intrinsic', type: 'b', props: { children: 'last' } },
        children: {
          kind: 'intrinsic',
          type: 'span',
          props: {
            children: [
              { kind: 'intrinsic', type: 'em', props: { children: 'deep' } },
            ],
          },
        },
      },
    });
  });

  it('decodes entities and handles boolean, namespaced, dashed and __proto__ attributes', () => {
    const { result } = runContent<{ result: runtime.IntrinsicDescription }>(`
      export const result = <svg:path hidden data-label="A &amp; B&#x1f98a;"
        xml:lang="en" __proto__={{ enabled: true }} title="first
        second" />;
    `);
    expect(result.type).toBe('svg:path');
    expect(result.props).toEqual({
      hidden: true,
      'data-label': 'A & B🦊',
      'xml:lang': 'en',
      ['__proto__']: { enabled: true },
      title: 'first second',
    });
    expect(Object.hasOwn(result.props, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(result.props)).toBe(Object.prototype);
  });

  it('uses JSX whitespace rules and discards comment-only children', () => {
    const { result, empty } = runContent<{
      result: runtime.IntrinsicDescription;
      empty: runtime.IntrinsicDescription;
    }>(`
      export const result = <p>
        Hello &amp;
        world
        {/* invisible */}
        {'!'}
        <br />
        end
      </p>;
      export const empty = <p>{/* no child */}
      </p>;
    `);
    expect(result.props.children).toEqual([
      'Hello & world',
      '!',
      { kind: 'intrinsic', type: 'br', props: {} },
      'end',
    ]);
    expect(Object.hasOwn(empty.props, 'children')).toBe(false);
  });

  it('represents fragments with the runtime marker and retains a single child directly', () => {
    const { result } = runContent<{ result: runtime.FragmentDescription }>(`
      export const result = <><p>one</p><>{42}</></>;
    `);
    expect(result).toEqual({
      kind: 'fragment',
      type: runtime.Fragment,
      props: {
        children: [
          { kind: 'intrinsic', type: 'p', props: { children: 'one' } },
          { kind: 'fragment', type: runtime.Fragment, props: { children: 42 } },
        ],
      },
    });
  });

  it('calls member components with explicit generic arguments and their original receiver', () => {
    const source = `
      const components = {
        label: 'receiver',
        Identity<T>(props: { value: T }) { return [this.label, props.value]; },
      };
      export const result = <components.Identity<number> value={123} />;
    `;
    const transformed = transformGtsx(source);
    expect(transformed.text).toContain('components.Identity<number>(');
    expect(() =>
      parse(transformed.text, {
        sourceType: 'module',
        plugins: ['typescript'],
      }),
    ).not.toThrow();
    const { result } = runContent<{
      result: runtime.ComponentDescription<never, unknown, never>;
    }>(source);
    expect(result.value).toEqual(['receiver', 123]);
  });

  it('supplies an empty props object for components without attributes or rendered children', () => {
    const { empty, comments, explicit } = runContent<{
      empty: runtime.ComponentDescription<never, number, never>;
      comments: runtime.ComponentDescription<never, number, never>;
      explicit: runtime.ComponentDescription<never, number, never>;
    }>(`
      function Count() { return arguments.length; }
      export const empty = <Count />;
      export const comments = <Count>{/* ignored */}</Count>;
      export const explicit = <Count {...{}} />;
    `);
    expect(empty.value).toBe(1);
    expect(comments.value).toBe(1);
    expect(explicit.value).toBe(1);
  });

  it('retains yield and await expressions in the scope of their containing function', async () => {
    const { render, asynchronous } = runContent<{
      render: () => Generator<
        string,
        runtime.ComponentDescription<never, unknown, never>,
        number
      >;
      asynchronous: () => Promise<runtime.IntrinsicDescription>;
    }>(`
      function View(props) { return props.value; }
      export function* render() { return <View value={yield 'input'} />; }
      export async function asynchronous() { return <p>{await Promise.resolve('ready')}</p>; }
    `);
    const iterator = render();
    expect(iterator.next()).toEqual({ value: 'input', done: false });
    expect(iterator.next(123)).toEqual({
      value: { kind: 'component', value: 123 },
      done: true,
    });
    await expect(asynchronous()).resolves.toEqual({
      kind: 'intrinsic',
      type: 'p',
      props: { children: 'ready' },
    });
  });

  it('avoids helper name collisions and keeps the hashbang first', () => {
    const source =
      '#!/usr/bin/env node\nconst __gtsx = 1; const __gtsx_ = 2; export const result = <p />;';
    const result = transformGtsx(source, { runtimeModule: '@example/ui' });
    expect(result.text.startsWith('#!/usr/bin/env node\nimport ')).toBe(true);
    const parsed = parse(result.text, {
      sourceType: 'module',
      plugins: ['typescript'],
    });
    const imported = parsed.program.body[0];
    expect(imported.type).toBe('ImportDeclaration');
    if (imported.type !== 'ImportDeclaration')
      throw new Error('Expected runtime import');
    expect(imported.source.value).toBe('@example/ui');
    expect(
      imported.specifiers.map((specifier) => specifier.local.name),
    ).not.toContain('__gtsx');
    expect(
      new Set(imported.specifiers.map((specifier) => specifier.local.name))
        .size,
    ).toBe(4);
    expect(result.text).toContain('const __gtsx = 1; const __gtsx_ = 2;');
  });

  it.each<PositionEncoding>(['utf-16', 'utf-8'])(
    'maps Unicode references and attribute names using %s offsets',
    (encoding) => {
      const source =
        'const café = "🦊"; export const result = <Box data-label={café} />;';
      const result = transformGtsx(source, { positionEncoding: encoding });
      const sourceReference = source.lastIndexOf('café');
      const virtualReference = result.text.lastIndexOf('café');
      expect(
        originalOffset(result, offset(result.text, virtualReference, encoding)),
      ).toBe(offset(source, sourceReference, encoding));
      const attribute = source.indexOf('data-label');
      expect(result.mappings).toContainEqual([
        offset(result.text, result.text.indexOf('"data-label"'), encoding),
        Buffer.byteLength('"data-label"'),
        offset(source, attribute, encoding),
        'data-label'.length,
        SpanMapKind.Alias,
      ]);
      let virtualEnd = 0;
      for (const [
        start,
        length,
        originalStart,
        originalLength,
      ] of result.mappings ?? []) {
        expect(start).toBeGreaterThanOrEqual(virtualEnd);
        expect(start + length).toBeLessThanOrEqual(
          offset(result.text, result.text.length, encoding),
        );
        expect(originalStart + originalLength).toBeLessThanOrEqual(
          offset(source, source.length, encoding),
        );
        virtualEnd = start + length;
      }
    },
  );

  it.each<PositionEncoding>(['utf-16', 'utf-8'])(
    'reports unsupported spread children at their %s source span',
    (encoding) => {
      const source =
        'const emoji = "🦊"; export const result = <p>{...items}</p>;';
      const result = transformGtsx(source, { positionEncoding: encoding });
      expect(result.diagnostics).toEqual([
        {
          code: 2,
          messageText: expect.stringContaining('spread children'),
          start: offset(source, source.indexOf('{...items}'), encoding),
          length: '{...items}'.length,
        },
      ]);
    },
  );

  it.each<PositionEncoding>(['utf-16', 'utf-8'])(
    'reports Babel parse errors in %s coordinates',
    (encoding) => {
      const source = 'const emoji = "🦊"; export const result = <p></div>;';
      const result = transformGtsx(source, { positionEncoding: encoding });
      expect(result.diagnostics).toEqual([
        {
          code: 1,
          messageText: expect.stringContaining('closing tag'),
          start: offset(source, source.indexOf('</div>'), encoding),
          length: 1,
        },
      ]);
      expect(result.text).toBe('');
    },
  );

  it('handles unrecoverable syntax errors and zero-width errors at end of input', () => {
    const source = 'export const result = <p>';
    const result = transformGtsx(source, { fileName: 'broken.gtsx' });
    expect(result.diagnostics).toEqual([
      {
        code: 1,
        messageText: expect.stringContaining('Unexpected token'),
        start: source.length,
        length: 0,
      },
    ]);
    expect(result.text).toBe('');
    expect(result.extension).toBe('.ts');
  });
});
