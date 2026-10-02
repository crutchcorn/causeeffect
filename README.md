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

For generator components, the [generator JSX setup](packages/jsx-content-mapper/README.md#setup)
preserves the types you get from a direct call when you use JSX:

```tsx
// greeting.gtsx
import type { JSX } from '@causeeffect/jsx-content-mapper/runtime';

type ViewElement = JSX.GeneratorElement<never, never, never>;

function* Greeting(): Generator<number, ViewElement, string> {
  const name = yield 123;
  return <p>Hello, {name}!</p>;
}

// Before: calling the generator directly.
const iterator = Greeting();
// Generator<number, ViewElement, string>

// After: using JSX with the content mapper.
const element = <Greeting />;
// JSX.GeneratorElement<number, ViewElement, string>
```

The yielded value is still a `number`, the return value is still a `ViewElement`,
and the value sent back into the generator is still a `string`. Wrapping the
component in JSX keeps all three types available to TypeScript. This generator
example is separate from Foldkit's synchronous Views above.

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
