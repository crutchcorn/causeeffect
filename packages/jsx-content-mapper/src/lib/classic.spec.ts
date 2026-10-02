import { parse } from '@babel/parser';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  transformGtsx,
  validateGtsxOptions,
  type GtsxOptions,
} from './content-mapper.js';

const options: GtsxOptions = {
  jsxRuntime: 'classic',
  jsxFactory: 'jsx.createElement',
  jsxFragmentFactory: 'jsx.Fragment',
};

function execute(source: string) {
  const transformed = transformGtsx(source, options);
  expect(transformed.diagnostics).toBeUndefined();
  const compiled = ts.transpileModule(transformed.text, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
    reportDiagnostics: true,
  });
  expect(compiled.diagnostics).toEqual([]);
  const exports: Record<string, unknown> = {};
  new Function('exports', compiled.outputText)(exports);
  return exports;
}

describe('classic JSX factories', () => {
  it('uses a local factory for every element and passes null props and variadic children', () => {
    const result = execute(`
      const jsx = {
        Fragment: 'fragment',
        createElement(tag, props, ...children) { return { tag, props, children }; },
      };
      function Component(props) { return props; }
      export const result = <><p>Hello &amp; world</p><Component id={123}>{'child'}</Component></>;
      export { Component };
    `);
    expect(result.result).toEqual({
      tag: 'fragment',
      props: null,
      children: [
        { tag: 'p', props: null, children: ['Hello & world'] },
        { tag: result.Component, props: { id: 123 }, children: ['child'] },
      ],
    });
    expect(
      transformGtsx('export const node = <p />;', options).text,
    ).not.toContain('import ');
  });

  it('preserves lexical factory receivers, prop spreads and explicit children attributes', () => {
    const result = execute(`
      const jsx = {
        Fragment: 'fragment',
        prefix: 'local',
        createElement(tag, props, ...children) { return { prefix: this.prefix, tag, props, children }; },
      };
      export const result = <p {...{ id: 'old', children: 'attribute' }} id="new">{'rendered'}</p>;
    `);
    expect(result.result).toEqual({
      prefix: 'local',
      tag: 'p',
      props: { id: 'new', children: 'attribute' },
      children: ['rendered'],
    });
  });

  it('keeps generator expressions in the enclosing scope and lets the factory own component behavior', () => {
    const result = execute(`
      const jsx = { createElement(tag, props) { return tag(props); } };
      function Component(props) { return props.value; }
      export function* view() { return <Component value={yield 'request'} />; }
    `);
    const view = result.view as () => Generator<string, number, number>;
    const iterator = view();
    expect(iterator.next()).toEqual({ value: 'request', done: false });
    expect(iterator.next(123)).toEqual({ value: 123, done: true });
  });

  it('retains explicit component type arguments as an instantiation expression', () => {
    const output = transformGtsx(
      'export const node = <Component<number> value={123} />;',
      options,
    );
    expect(output.text).toContain('jsx.createElement(Component<number>,');
    expect(() =>
      parse(output.text, { sourceType: 'module', plugins: ['typescript'] }),
    ).not.toThrow();
  });

  it('normalizes factory references through Babel instead of injecting option comments into code', () => {
    const output = transformGtsx('export const node = <p />;', {
      jsxRuntime: 'classic',
      jsxFactory: 'jsx.createElement // comment',
    });
    expect(output.text).toContain('jsx.createElement("p", null)');
    expect(output.text).not.toContain('// comment');
  });

  it('defaults to the standard React classic factory names', () => {
    const output = transformGtsx('export const node = <><p /></>;', {
      jsxRuntime: 'classic',
    });
    expect(output.text).toContain(
      'React.createElement(React.Fragment, null, React.createElement("p", null))',
    );
  });

  it.each([
    { jsxRuntime: 'invalid' },
    { jsxRuntime: 'classic', jsxFactory: 'factory()' },
    { jsxRuntime: 'classic', jsxFragmentFactory: 'a["Fragment"]' },
    { jsxRuntime: 'classic', runtimeModule: 'a-runtime' },
    { jsxFactory: 'factory' },
  ])('rejects an invalid configuration %j', (invalid) => {
    const config = invalid as GtsxOptions;
    expect(validateGtsxOptions(config).length).toBeGreaterThan(0);
    expect(() => transformGtsx('export {};', config)).toThrow(TypeError);
  });
});
