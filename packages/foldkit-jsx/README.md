# Foldkit JSX

`@causeeffect/foldkit-jsx` adapts a [Foldkit view](https://foldkit.dev/core/view)'s typed `HtmlBuilder` to a classic JSX factory. Foldkit remains responsible for HTML, event handlers, dispatch boundaries, and [Submodels](https://foldkit.dev/core/submodel). The content mapper only translates JSX syntax into configurable factory calls.

## Configure `.gtsx`

Pass these options to `@causeeffect/jsx-content-mapper` in your TypeScript content mapper configuration and to its Vite plugin:

```json
{
  "jsxRuntime": "classic",
  "jsxFactory": "jsx.createElement",
  "jsxFragmentFactory": "jsx.Fragment"
}
```

Classic mode uses the factory expression in your file's scope. It does not inject a runtime import. See [the runnable Foldkit example](../../examples/foldkit/) for the complete TypeScript nightly and Vite setup.

## Views

Create `jsx` inside each view using the `h` argument supplied by Foldkit:

```tsx
import { createJsx } from '@causeeffect/foldkit-jsx';
import type { Document, HtmlBuilder } from 'foldkit/html';

type Message = { readonly _tag: 'ClickedIncrement' };
type Model = { readonly count: number };

export function view(model: Model, h: HtmlBuilder<Message>): Document {
  const jsx = createJsx(h);
  return {
    title: `Counter: ${model.count}`,
    body: (
      <main Class="counter">
        <p>{model.count}</p>
        <button OnClick={{ _tag: 'ClickedIncrement' }}>Increment</button>
      </main>
    ),
  };
}
```

Intrinsic props use Foldkit's constructor names and parameter types directly.
`Class="counter"` calls `h.Class('counter')`, `OnClick={message}` calls
`h.OnClick(message)`, and `OnInput={(value) => message(value)}` calls `h.OnInput`
with a callback whose `value` is contextually typed as `string`. Event Messages
must belong to the current view. Names keep Foldkit's exact casing, such as
`Id`, `Role`, `AriaLabel`, `Value`, `Checked`, and `Style`; lowercase `class` and
`onClick` are rejected.

The adapter derives prop types from `HtmlBuilder<Message>` and discovers the
corresponding constructors on the supplied builder. It contains no copied HTML
attribute table or event implementation. The generic content mapper preserves
the prop names in its classic factory calls and has no Foldkit dependency.

`undefined` props are omitted; boolean attribute values including `false` are
passed through. `AllowDrop` is a boolean switch for the zero-argument
`h.AllowDrop()` helper. The `attributes` prop remains an escape hatch for
`childAttributes`, required multi-argument helpers such as `h.DataAttribute`,
`h.Attribute`, and `h.OnCutText`, and optional controls such as `h.OnClick`
options. Its attributes are applied before direct props, using Foldkit's normal
attribute combination behavior.

`key` delegates to `h.keyed(tag)`, while `Key` uses `h.Key` directly. Numbers and bigints become text; nested arrays and fragments flatten; `null`, `undefined`, and booleans render nothing. A fragment is a list of children, so a root Foldkit view should return an element or `null`. Void elements accept no children. A textarea uses `Value={text}` and rejects both children and `InnerHTML`.

Ordinary function components receive their props and a `children` array when JSX supplies children. Required props, declared child types, and the component's return type remain checked. Declare an optional `children` prop for components that render nested markup.

## Submodels

Define a child with Foldkit's normal `Submodel.defineView`. Its `.gtsx` view creates its own adapter from its child builder:

```tsx
import { Submodel } from 'foldkit';
import { createJsx } from '@causeeffect/foldkit-jsx';

export const childView = Submodel.defineView<ChildModel, ChildMessage>(
  (model, h) => {
    const jsx = createJsx(h);
    return <button OnClick={childMessage}>{model.count}</button>;
  },
);
```

Embed that child through the parent's bound component:

```tsx
const jsx = createJsx(h);
return (
  <section>
    <jsx.Submodel
      slotId="counter"
      model={model.counter}
      view={childView}
      toParentMessage={(message) => GotCounterMessage({ message })}
    />
  </section>
);
```

`jsx.Submodel` delegates directly to `h.submodel`. Foldkit infers the child's Model and Message from its branded view. Views that declare per-render inputs require `viewInputs` of that exact type; views without inputs reject that prop. Each embed site needs a distinct `slotId`. Update routing still uses Foldkit's `Update.foldChild`, as demonstrated by the example.

The adapter never stores a process-wide builder. Create it in each root or child view and pass builders to extracted helpers as Foldkit recommends.

## Verify

```sh
pnpm --filter @causeeffect/foldkit-jsx build
pnpm --filter @causeeffect/foldkit-jsx typecheck
pnpm --filter @causeeffect/foldkit-jsx test
pnpm --filter @causeeffect/foldkit-jsx lint
```

The tests compare generated VNodes with Foldkit builders, check fragments and keying, drive a real Submodel event through Foldkit's Scene harness, and assert compile-time failures for mismatched messages, models, inputs, props, and children.
