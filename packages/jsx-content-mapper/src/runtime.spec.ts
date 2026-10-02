import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  createComponent,
  createElement,
  emptyProps,
  Fragment,
  type JSX,
} from './runtime.js';

describe('generator JSX runtime', () => {
  it('keeps generator components lazy and retains their protocol parameters', () => {
    const entered = vi.fn();

    function* Component(): Generator<number, string, boolean> {
      entered();
      const accepted = yield 123;
      return accepted ? 'accepted' : 'rejected';
    }

    const component = vi.fn(Component);
    const element = createComponent(component());

    expectTypeOf(element).toEqualTypeOf<
      JSX.GeneratorElement<number, string, boolean>
    >();
    expect(element.kind).toBe('component');
    expect(component).toHaveBeenCalledOnce();
    expect(entered).not.toHaveBeenCalled();

    if (element.kind !== 'component') throw new Error('Expected component');
    const result = element.value;
    expect(component).toHaveBeenCalledOnce();
    expect(entered).not.toHaveBeenCalled();

    // A renderer selects the synchronous generator protocol before advancing it.
    if (typeof result === 'string' || !(Symbol.iterator in result)) {
      throw new Error('Expected synchronous generator');
    }
    expect(result.next()).toEqual({ value: 123, done: false });
    expect(result.next(true)).toEqual({ value: 'accepted', done: true });
    expect(entered).toHaveBeenCalledOnce();
    expect(Object.isFrozen(element)).toBe(true);
  });

  it('preserves inferred types, generic arguments and contextual prop callbacks', () => {
    function* Identity<Value>(props: {
      value: Value;
      map?: (value: Value) => Value;
    }) {
      yield props.value;
      return props.map?.(props.value);
    }

    const inferred = createComponent(
      Identity({ value: 123, map: (value) => value + 1 }),
    );
    const explicit = createComponent(Identity<string>({ value: 'hello' }));

    expectTypeOf(inferred).toEqualTypeOf<
      JSX.GeneratorElement<number, number | undefined, unknown>
    >();
    expectTypeOf(explicit).toEqualTypeOf<
      JSX.GeneratorElement<string, string | undefined, unknown>
    >();
  });

  it('retains nested element return types and TypeScript’s inferred next type', () => {
    function* Test() {
      yield 123;
      return createElement('p', { children: 'Hello' });
    }

    const element = createComponent(Test());

    expectTypeOf(element).toEqualTypeOf<
      JSX.GeneratorElement<
        number,
        JSX.GeneratorElement<never, never, never>,
        unknown
      >
    >();
  });

  it('passes empty props to optional object props and no-argument components', () => {
    function* Optional(props: { name?: string }) {
      yield props.name ?? 'unnamed';
    }
    function* None(...props: []) {
      yield (props as readonly unknown[])[0];
    }
    function* Required(props: { name: string }) {
      yield props.name;
    }

    const optional = Optional(...emptyProps<typeof Optional>());
    const none = None(...emptyProps<typeof None>());

    expect(optional.next()).toEqual({ value: 'unnamed', done: false });
    expect(none.next()).toEqual({ value: {}, done: false });

    // @ts-expect-error An empty props object cannot satisfy required properties.
    createComponent(Required(...emptyProps<typeof Required>()));
  });

  it('retains generic defaults and zero-argument overloads with empty props', () => {
    function* Generic<Value = string>(props: { value?: Value }) {
      yield props.value;
    }
    function Overloaded(): Generator<number, void, unknown>;
    function Overloaded(props: {
      value: string;
    }): Generator<string, void, unknown>;
    function* Overloaded(props?: {
      value: string;
    }): Generator<number | string, void, unknown> {
      yield props?.value ?? 123;
    }

    const generic = createComponent(Generic(...emptyProps<typeof Generic>()));
    const explicit = createComponent(
      Generic<number>(...emptyProps<typeof Generic>()),
    );
    const overloaded = createComponent(
      Overloaded(...emptyProps<typeof Overloaded>()),
    );

    expectTypeOf(generic).toEqualTypeOf<
      JSX.GeneratorElement<string | undefined, void, unknown>
    >();
    expectTypeOf(explicit).toEqualTypeOf<
      JSX.GeneratorElement<number | undefined, void, unknown>
    >();
    expectTypeOf(overloaded).toEqualTypeOf<
      JSX.GeneratorElement<number, void, unknown>
    >();
  });

  it('retains every generator channel across synchronous and asynchronous unions', () => {
    function* Numeric(): Generator<number, string, boolean> {
      yield 123;
      return 'numeric';
    }
    function* Textual(): Generator<string, number, string> {
      yield 'textual';
      return 123;
    }
    async function* Asynchronous(): AsyncGenerator<string, number, string> {
      yield 'asynchronous';
      return 123;
    }

    const synchronous = createComponent(
      Math.random() < 0.5 ? Numeric() : Textual(),
    );
    const mixed = createComponent(
      Math.random() < 0.5 ? Numeric() : Asynchronous(),
    );

    expectTypeOf(synchronous).toEqualTypeOf<
      | JSX.GeneratorElement<number, string, boolean>
      | JSX.GeneratorElement<string, number, string>
    >();
    expectTypeOf(mixed).toEqualTypeOf<
      | JSX.GeneratorElement<number, string, boolean>
      | JSX.GeneratorElement<string, number, string>
    >();
    expect(synchronous.kind).toBe('component');
    expect(mixed.kind).toBe('component');
  });

  it('represents intrinsic elements and fragments without generator effects', () => {
    const props = { id: 'greeting', children: 'Hello' };
    const intrinsic = createElement('p', props);
    const fragment = createElement(Fragment, {
      children: [intrinsic, 'World'],
    });

    expectTypeOf(intrinsic).toEqualTypeOf<
      JSX.GeneratorElement<never, never, never>
    >();
    expectTypeOf(fragment).toEqualTypeOf<
      JSX.GeneratorElement<never, never, never>
    >();
    expect(intrinsic).toEqual({ kind: 'intrinsic', type: 'p', props });
    expect(fragment).toEqual({
      kind: 'fragment',
      type: Fragment,
      props: { children: [intrinsic, 'World'] },
    });

    props.id = 'changed';
    if (intrinsic.kind !== 'intrinsic') throw new Error('Expected intrinsic');
    expect(intrinsic.props['id']).toBe('greeting');
    expect(Object.isFrozen(intrinsic)).toBe(true);
    expect(Object.isFrozen(intrinsic.props)).toBe(true);
    expect(createElement('hr')).toEqual({
      kind: 'intrinsic',
      type: 'hr',
      props: {},
    });
  });

  it('supports asynchronous generators without invoking them during construction', async () => {
    async function* Component(): AsyncGenerator<number, string, boolean> {
      const accepted = yield 123;
      return accepted ? 'accepted' : 'rejected';
    }

    const component = vi.fn(Component);
    const element = createComponent(component());

    expectTypeOf(element).toEqualTypeOf<
      JSX.GeneratorElement<number, string, boolean>
    >();
    expect(component).toHaveBeenCalledOnce();

    if (element.kind !== 'component') throw new Error('Expected component');
    const result = element.value;
    if (typeof result === 'string' || !(Symbol.asyncIterator in result)) {
      throw new Error('Expected asynchronous generator');
    }
    await expect(result.next()).resolves.toEqual({ value: 123, done: false });
    await expect(result.next(true)).resolves.toEqual({
      value: 'accepted',
      done: true,
    });
  });

  it('evaluates ordinary components eagerly and preserves their return type', () => {
    const component = vi.fn(() => createElement('p', { children: 'Hello' }));
    const element = createComponent(component());

    expectTypeOf(element).toEqualTypeOf<
      JSX.GeneratorElement<
        never,
        JSX.GeneratorElement<never, never, never>,
        never
      >
    >();
    expect(component).toHaveBeenCalledOnce();

    if (element.kind !== 'component') throw new Error('Expected component');
    expect(element.value).toEqual({
      kind: 'intrinsic',
      type: 'p',
      props: { children: 'Hello' },
    });
    expect(component).toHaveBeenCalledOnce();
  });
});
