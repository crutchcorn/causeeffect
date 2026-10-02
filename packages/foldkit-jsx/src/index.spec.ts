import { inertHtml } from 'foldkit/html';
import type { Html, HtmlBuilder } from 'foldkit/html';
import { defineView } from 'foldkit/submodel';
import { Scene } from 'foldkit/test';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { createJsx } from './index.js';

function expectSameElement(actual: Html, expected: Html): void {
  if (actual === null || expected === null) {
    expect(actual).toEqual(expected);
    return;
  }
  // Value/Checked create a new live-DOM hook for each builder invocation.
  const { hook: actualHooks, ...actualData } = actual.data ?? {};
  const { hook: expectedHooks, ...expectedData } = expected.data ?? {};
  expect({ ...actual, data: actualData }).toEqual({
    ...expected,
    data: expectedData,
  });
  expect(Object.keys(actualHooks ?? {})).toEqual(
    Object.keys(expectedHooks ?? {}),
  );
}

describe('Foldkit JSX', () => {
  it('uses the builder for intrinsic elements, attributes and keys', () => {
    const jsx = createJsx(inertHtml);
    const attributes = [inertHtml.Class('card'), inertHtml.Id('example')];
    expect(jsx.createElement('div', { attributes }, 'Hello')).toEqual(
      inertHtml.div(attributes, ['Hello']),
    );
    expect(
      jsx.createElement('li', { key: 'item', attributes }, 'Item'),
    ).toEqual(inertHtml.keyed('li')('item', attributes, ['Item']));
  });

  it('converts direct HTML props into Foldkit attributes', () => {
    const jsx = createJsx(inertHtml);
    expectSameElement(
      jsx.createElement('input', {
        attributes: [inertHtml.DataAttribute('state', 'edited')],
        Id: 'draft',
        Class: 'field',
        Value: 'Draft',
        Checked: true,
        AriaLabel: 'Draft label',
        Style: { color: 'red', 'font-weight': 'bold' },
      }),
      inertHtml.input([
        inertHtml.DataAttribute('state', 'edited'),
        inertHtml.Id('draft'),
        inertHtml.Class('field'),
        inertHtml.Value('Draft'),
        inertHtml.Checked(true),
        inertHtml.AriaLabel('Draft label'),
        inertHtml.Style({ color: 'red', 'font-weight': 'bold' }),
      ]),
    );
    expectSameElement(
      jsx.createElement('textarea', { Value: 'Draft' }),
      inertHtml.textarea([inertHtml.Value('Draft')]),
    );
  });

  it('combines direct props with the attribute escape hatch and keys', () => {
    const jsx = createJsx(inertHtml);
    expect(
      jsx.createElement(
        'li',
        {
          key: 'item',
          attributes: [inertHtml.Title('More information')],
          Class: 'item',
        },
        'Item',
      ),
    ).toEqual(
      inertHtml.keyed('li')(
        'item',
        [inertHtml.Title('More information'), inertHtml.Class('item')],
        ['Item'],
      ),
    );
    expect(
      jsx.createElement('div', {
        attributes: [inertHtml.Class('original')],
        Class: 'replacement',
      }),
    ).toEqual(
      inertHtml.div([
        inertHtml.Class('original'),
        inertHtml.Class('replacement'),
      ]),
    );
    expect(
      jsx.createElement('li', { Key: 'item', Class: 'item' }, 'Item'),
    ).toEqual(
      inertHtml.li([inertHtml.Key('item'), inertHtml.Class('item')], ['Item']),
    );
  });

  it('omits undefined attributes while retaining false boolean values', () => {
    const jsx = createJsx(inertHtml);
    expectSameElement(
      jsx.createElement('input', {
        Class: undefined,
        Value: undefined,
        Title: undefined,
        Checked: false,
        Disabled: false,
      }),
      inertHtml.input([inertHtml.Checked(false), inertHtml.Disabled(false)]),
    );
  });

  it('flattens fragments and arrays, renders numbers and drops empty conditions', () => {
    const jsx = createJsx(inertHtml);
    const fragment = jsx.createElement(
      jsx.Fragment,
      null,
      'A',
      [1, [false, null, undefined, true, 2n]],
      jsx.createElement('strong', null, 'B'),
    );
    expect(jsx.createElement('p', null, fragment)).toEqual(
      inertHtml.p([], ['A', '1', '2', inertHtml.strong([], ['B'])]),
    );
  });

  it('passes component props and children without changing their return type', () => {
    const jsx = createJsx(inertHtml);
    const Label = (props: {
      text: string;
      children?: ReadonlyArray<Html | string>;
    }) => props.text;
    const result = jsx.createElement(Label, { text: 'Hello' }, 'World');
    expectTypeOf(result).toEqualTypeOf<string>();
    expect(result).toBe('Hello');

    const Content = (props: { children?: ReadonlyArray<Html | string> }) =>
      inertHtml.div([], props.children);
    expect(jsx.createElement(Content, null, 'Child')).toEqual(
      inertHtml.div([], ['Child']),
    );
  });

  it('supports a children prop and lets positional children replace it', () => {
    const jsx = createJsx(inertHtml);
    expect(jsx.createElement('div', { children: ['One', 2] })).toEqual(
      inertHtml.div([], ['One', '2']),
    );
    expect(jsx.createElement('div', { children: 'Ignored' }, 'Actual')).toEqual(
      inertHtml.div([], ['Actual']),
    );
  });

  it('keeps textarea values and void elements under Foldkit control', () => {
    const jsx = createJsx(inertHtml);
    expect(
      jsx.createElement('textarea', { attributes: [inertHtml.Value('Draft')] }),
    ).toMatchObject({ sel: 'textarea', data: { props: { value: 'Draft' } } });
    const unchecked = jsx.createElement as unknown as (
      tag: string,
      props: unknown,
      ...children: unknown[]
    ) => unknown;
    expect(() => unchecked('textarea', null, 'Draft')).toThrow('h.Value');
    expect(() => unchecked('input', null, 'Child')).toThrow(
      'cannot have JSX children',
    );
    expect(() => unchecked('textarea', { InnerHTML: 'Draft' })).toThrow(
      'textarea',
    );
    expect(() => unchecked('button', { unsupported: 'value' })).toThrow(
      'Unsupported',
    );
    expect(() => unchecked('button', { onClick: {} })).toThrow('Unsupported');
    expect(() => unchecked('unknown', null)).toThrow('Unsupported');
    expect(() => unchecked('submodel', null)).toThrow('Unsupported');
    expect(() => unchecked('Class', null)).toThrow('Unsupported');
    expect(() => unchecked('toString', null)).toThrow('Unsupported');
  });

  it('delegates Submodel boundaries and child message wrapping to Foldkit', () => {
    type ChildMessage = { _tag: 'Increment' };
    type ParentMessage = { _tag: 'Child'; message: ChildMessage };
    const childView = defineView<
      { count: number },
      ChildMessage,
      { label: string }
    >((model, inputs, h) => {
      const jsx = createJsx(h);
      return jsx.createElement(
        'button',
        { OnClick: { _tag: 'Increment' } },
        `${inputs.label}: ${model.count}`,
      );
    });
    Scene.scene(
      {
        update: (model: { count: number }, message: ParentMessage) => ({
          model: {
            count: model.count + (message.message._tag === 'Increment' ? 1 : 0),
          },
        }),
        view: (model, h) => {
          const jsx = createJsx(h);
          return jsx.createElement(jsx.Submodel, {
            slotId: 'counter',
            model,
            view: childView,
            viewInputs: { label: 'Counter' },
            toParentMessage: (message) => ({ _tag: 'Child', message }),
          });
        },
      },
      Scene.given({ count: 0 }),
      Scene.expect(Scene.role('button')).toHaveText('Counter: 0'),
      Scene.click(Scene.role('button')),
      Scene.expect(Scene.role('button')).toHaveText('Counter: 1'),
    );
  });

  it('passes input values to direct message callbacks', () => {
    type Message = { _tag: 'Input'; value: string };
    Scene.scene(
      {
        update: (_model: { value: string }, message: Message) => ({
          model: { value: message.value },
        }),
        view: (model, h) => {
          const jsx = createJsx(h);
          return jsx.createElement('input', {
            AriaLabel: 'Draft',
            Value: model.value,
            OnInput: (value) => ({ _tag: 'Input', value }),
          });
        },
      },
      Scene.given({ value: '' }),
      Scene.type(Scene.role('textbox'), 'Typed draft'),
      Scene.expect(Scene.role('textbox')).toHaveValue('Typed draft'),
    );
  });
});

type ChildMessage = { _tag: 'Increment' };
type ParentMessage = { _tag: 'Child'; message: ChildMessage };

// Checked by `tsc -b`; these invalid calls must keep failing as the factory evolves.
export function checkFactoryTypes(
  h: HtmlBuilder<ParentMessage>,
  childH: HtmlBuilder<ChildMessage>,
): void {
  const jsx = createJsx(h);
  const view = defineView<{ count: number }, ChildMessage, { label: string }>(
    (_model, _inputs, builder) => builder.div([]),
  );
  const plainView = defineView<{ count: number }, ChildMessage>(
    (_model, builder) => builder.div([]),
  );
  const toParentMessage = (message: ChildMessage): ParentMessage => ({
    _tag: 'Child',
    message,
  });
  const config = {
    slotId: 'child',
    model: { count: 0 },
    view,
    viewInputs: { label: 'Counter' },
    toParentMessage,
  };
  jsx.createElement(jsx.Submodel, config);
  jsx.createElement(jsx.Submodel, {
    ...config,
    toParentMessage: (message) => {
      expectTypeOf(message).toEqualTypeOf<ChildMessage>();
      return toParentMessage(message);
    },
  });
  jsx.createElement(jsx.Submodel, {
    slotId: 'plain',
    model: { count: 0 },
    view: plainView,
    toParentMessage,
  });
  // @ts-expect-error The child Model must match its branded view.
  jsx.createElement(jsx.Submodel, { ...config, model: { name: 'Wrong' } });
  // @ts-expect-error A view declaring inputs requires them at the embed site.
  jsx.createElement(jsx.Submodel, {
    slotId: 'child',
    model: { count: 0 },
    view,
    toParentMessage,
  });
  // @ts-expect-error View inputs have the exact type declared by the child.
  jsx.createElement(jsx.Submodel, { ...config, viewInputs: { label: 123 } });
  // @ts-expect-error Messages must be lifted into the parent Message universe.
  jsx.createElement(jsx.Submodel, {
    ...config,
    toParentMessage: (message: ChildMessage) => message,
  });
  // @ts-expect-error A view with no inputs does not accept a viewInputs prop.
  jsx.createElement(jsx.Submodel, { ...config, view: plainView });
  // @ts-expect-error An ordinary function is not a branded Foldkit Submodel view.
  jsx.createElement(jsx.Submodel, { ...config, view: () => null });
  // @ts-expect-error Submodels do not accept positional JSX children.
  jsx.createElement(jsx.Submodel, config, 'Child');
  // @ts-expect-error Child handlers cannot dispatch a parent Message directly.
  childH.OnClick({ _tag: 'Child', message: { _tag: 'Increment' } });
  // @ts-expect-error The parent cannot attach a child event attribute directly.
  jsx.createElement('button', {
    attributes: [childH.OnClick({ _tag: 'Increment' })],
  });
  // @ts-expect-error Void elements do not accept children.
  jsx.createElement('input', null, 'Child');
  // @ts-expect-error Textarea uses h.Value for content.
  jsx.createElement('textarea', { children: 'Draft' });
  // @ts-expect-error Textarea cannot own content through InnerHTML.
  jsx.createElement('textarea', { attributes: [h.InnerHTML('Draft')] });
  // @ts-expect-error Textarea cannot own content through a direct InnerHTML prop.
  jsx.createElement('textarea', { InnerHTML: 'Draft' });
  // @ts-expect-error Intrinsic element names come from Foldkit's TagName union.
  jsx.createElement('unknown-tag', null);
  jsx.createElement('button', {
    OnClick: toParentMessage({ _tag: 'Increment' }),
  });
  jsx.createElement('input', {
    OnInput: (value) => {
      expectTypeOf(value).toEqualTypeOf<string>();
      return toParentMessage({ _tag: 'Increment' });
    },
  });
  // @ts-expect-error Direct root events must produce the parent Message.
  jsx.createElement('button', { OnClick: { _tag: 'Increment' } });
  // @ts-expect-error Direct callback events must return the parent Message.
  jsx.createElement('input', { OnInput: () => ({ _tag: 'Increment' }) });
  // @ts-expect-error Input callbacks receive the DOM's string value.
  jsx.createElement('input', {
    OnInput: (value: number) => {
      expectTypeOf(value).toEqualTypeOf<number>();
      return toParentMessage({ _tag: 'Increment' });
    },
  });
  // @ts-expect-error Click handlers are Message values, not callback functions.
  jsx.createElement('button', { OnClick: () => undefined });
  // @ts-expect-error Class accepts a string.
  jsx.createElement('button', { Class: 123 });
  // @ts-expect-error Checked accepts a boolean.
  jsx.createElement('input', { Checked: 'yes' });
  // @ts-expect-error Styles use Foldkit's string-valued style record.
  jsx.createElement('div', { Style: { opacity: 0.5 } });
  // @ts-expect-error Props retain Foldkit's helper casing.
  jsx.createElement('button', {
    onClick: toParentMessage({ _tag: 'Increment' }),
  });
  const Label = ({ text }: { text: string }) => text;
  // @ts-expect-error Components retain their required prop types.
  jsx.createElement(Label, { text: 123 });
  // @ts-expect-error Self-closing components still require their mandatory props.
  jsx.createElement(Label, null);
  // @ts-expect-error Components that do not declare children cannot receive them.
  jsx.createElement(Label, { text: 'Hello' }, 'Unexpected');
  const TextChildren = (props: { children: ReadonlyArray<string> }) =>
    props.children.join('');
  jsx.createElement(TextChildren, null, 'One', 'Two');
  // @ts-expect-error Positional children retain the component's declared types.
  jsx.createElement(TextChildren, null, 123);
  // @ts-expect-error Required children cannot be omitted.
  jsx.createElement(TextChildren, null);
  const Pair = (props: { children: readonly [string, number] }) =>
    props.children[0];
  jsx.createElement(Pair, null, 'One', 2);
  // @ts-expect-error Fixed child tuples retain their arity.
  jsx.createElement(Pair, null, 'One');
  // @ts-expect-error Fixed child tuples retain their positional types.
  jsx.createElement(Pair, null, 2, 'One');
}
