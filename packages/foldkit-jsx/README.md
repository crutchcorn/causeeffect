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
      <main attributes={[h.Class('counter')]}>
        <p>{model.count}</p>
        <button attributes={[h.OnClick({ _tag: 'ClickedIncrement' })]}>
          Increment
        </button>
      </main>
    ),
  };
}
```

Keep using Foldkit's `h.Class`, `h.OnClick`, `h.OnInput`, and other attribute constructors through the `attributes` prop. This preserves the exact Message type and supports `childAttributes` without maintaining another HTML attribute API. Direct props such as `className` and `onClick` are rejected.

`key` delegates to `h.keyed(tag)`. Numbers and bigints become text; nested arrays and fragments flatten; `null`, `undefined`, and booleans render nothing. A fragment is a list of children, so a root Foldkit view should return an element or `null`. Void elements accept no children. A textarea uses `attributes={[h.Value(text)]}` and rejects both children and `h.InnerHTML`.

Ordinary function components receive their props and a `children` array when JSX supplies children. Required props, declared child types, and the component's return type remain checked. Declare an optional `children` prop for components that render nested markup.

## Submodels

Define a child with Foldkit's normal `Submodel.defineView`. Its `.gtsx` view creates its own adapter from its child builder:

```tsx
import { Submodel } from 'foldkit';
import { createJsx } from '@causeeffect/foldkit-jsx';

export const childView = Submodel.defineView<ChildModel, ChildMessage>(
  (model, h) => {
    const jsx = createJsx(h);
    return (
      <button attributes={[h.OnClick(childMessage)]}>{model.count}</button>
    );
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
