# CauseEffect

JSX for [Effect](https://effect.website), with generator types preserved.

CauseEffect keeps a generator's yielded values, return value, and next-value
parameter intact when you use it through JSX. The error and service types carried
by yielded Effects stay available too. The goal is to build Effect-powered UIs
with the same type safety as the programs behind them.

The project is experimental. [Foldkit](https://foldkit.dev) is our first working
example: write its Views and Submodels with JSX in **`.gtsx`** files, while keeping
its typed models and messages.

## Foldkit before and after

Before, a Hello world View uses Foldkit's HTML helpers:

```ts
import type { Document, HtmlBuilder } from 'foldkit/html';

type Model = { readonly name: string };
type Message = { readonly _tag: 'ClickedHello' };

export function view(model: Model, h: HtmlBuilder<Message>): Document {
  return {
    title: 'Hello world',
    body: h.main(
      [h.Class('hello')],
      [
        h.h1([], ['Hello, ', model.name, '!']),
        h.button([h.OnClick({ _tag: 'ClickedHello' })], ['Say hello']),
      ],
    ),
  };
}
```

After, the same View in `view.gtsx` uses JSX:

```tsx
import { createJsx } from '@causeeffect/foldkit-jsx';
import type { Document, HtmlBuilder } from 'foldkit/html';

type Model = { readonly name: string };
type Message = { readonly _tag: 'ClickedHello' };

export function view(model: Model, h: HtmlBuilder<Message>): Document {
  const jsx = createJsx(h);

  return {
    title: 'Hello world',
    body: (
      <main Class="hello">
        <h1>Hello, {model.name}!</h1>
        <button OnClick={{ _tag: 'ClickedHello' }}>Say hello</button>
      </main>
    ),
  };
}
```

Props use Foldkit's names, such as `Class`, `OnClick`, and `AriaLabel`. Event
messages are checked against the View's Message type. Foldkit runs the application
and handles updates; its Views remain ordinary synchronous functions.

## Generator types before and after

Before, ordinary JSX gives the expression the runtime's `JSX.Element` type,
even when the component is a generator. This assumes a JSX runtime that accepts
generator components:

```tsx
// greeting.tsx
function* Greeting() {
  yield 123;
  return <p>Hello</p>;
}

const element = <Greeting />;
// JSX.Element
```

The direct call `Greeting()` still has the inferred type
`Generator<number, JSX.Element, unknown>`, but `<Greeting />` loses those generator
parameters.

After, the same component in a `.gtsx` file with the
[generator JSX setup](packages/jsx-content-mapper/README.md#setup) keeps its inferred
types without a return-type annotation:

```tsx
// greeting.gtsx
function* Greeting() {
  yield 123;
  return <p>Hello</p>;
}

const element = <Greeting />;
// JSX.GeneratorElement<
//   number,
//   JSX.GeneratorElement<never, never, never>,
//   unknown
// >
```

The yielded value is a `number`, and the JSX return is inferred as
`JSX.GeneratorElement<never, never, never>`. TypeScript infers `unknown` for the
next-value type, which the mapper also keeps. All three remain available through
JSX. This generator example is separate from Foldkit's synchronous Views above.

## Install and run

**This currently requires TypeScript 7.1 nightly.** The example pins
`7.1.0-dev.20261002.1`; stable TypeScript cannot type-check these `.gtsx` files yet.
The setup below installs and configures the nightly compiler and Effect 4 for you.

With Node.js **24.11 or newer** and **PNPM 10** installed:

```sh
git clone https://github.com/crutchcorn/causeeffect.git
cd causeeffect
pnpm install
pnpm --filter @causeeffect/foldkit-example dev
```

Open the URL printed by Vite. The example shows two independent counter
Submodels, typed button messages, and a parent action that resets both counters.

To check your `.gtsx` files, run:

```sh
pnpm --filter @causeeffect/foldkit-example typecheck
```

The [complete Foldkit example](examples/foldkit/README.md) includes application
setup and Submodels. To use the same setup in another application, start with its
[TypeScript configuration](examples/foldkit/tsconfig.json) and
[Vite configuration](examples/foldkit/vite.config.mts), and write your Views in
`.gtsx` files.
