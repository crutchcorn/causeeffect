<div align="center">
<h1>CauseEffect</h1>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./assets/logo-dark.svg" />
  <source media="(prefers-color-scheme: light)" srcset="./assets/logo-light.svg" />
  <img alt="CauseEffect logo" src="./assets/logo-light.svg" width="128" height="128" />
</picture>

<p>JSX for <a href="https://effect.website">Effect</a>, with generator types preserved.</p>

</div>

<hr />

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

## Installation

Use Node.js **24.11 or newer** and a TypeScript **7.1 nightly**. The setup guides
pin `7.1.0-dev.20261002.1`; stable TypeScript cannot type-check `.gtsx` files yet.
Install the packages into your application with npm, following the guide for the
component you want to use:

| Component                                           | Package                                         | Setup guide                                                                                             |
| --------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Foldkit Views and Submodels with JSX                | `@causeeffect/foldkit-jsx`                      | [Install and configure Foldkit JSX](packages/foldkit-jsx/README.md#setup)                               |
| Generator JSX runtime and TypeScript content mapper | `@causeeffect/jsx-content-mapper`               | [Install and configure the mapper](packages/jsx-content-mapper/README.md#setup)                         |
| Compile `.gtsx` files with Vite                     | `@causeeffect/jsx-content-mapper`               | [Configure JavaScript builds](packages/jsx-content-mapper/README.md#javascript-builds-and-declarations) |
| VS Code language support                            | GTSX extension (`CauseEffect.causeeffect-gtsx`) | [Install GTSX](https://marketplace.visualstudio.com/items?itemName=CauseEffect.causeeffect-gtsx)        |

For a Foldkit application, start with the Foldkit JSX guide. It covers installing
the adapter, mapper, TypeScript, and Vite, then configuring them together. For
generator components, start with the mapper guide. The Vite plugin is included in
the mapper package through its `/vite` export.

The [runnable Foldkit example](examples/foldkit/README.md) demonstrates two
independent counter Submodels, typed button messages, and a parent action that
resets both counters. Its README covers running the example and explains the
application's Views and Submodels.

## VS Code extension

The **GTSX** extension adds TypeScript editor support for `.gtsx` files: syntax
highlighting, hover types, completion, inline errors, go to definition,
references, and rename. Hover over `element` in the generator example above to see
its preserved yield, return, and next types.

Install [GTSX from the Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=CauseEffect.causeeffect-gtsx)
in VS Code **1.126 or later**. Follow the
[extension installation guide](apps/vsc-extension/README.md#install-and-enable)
to enable TypeScript Native Preview and TypeScript 7 Nightly. Then open your
project folder, trust the workspace, and run
**GTSX: Enable TypeScript Native Language Support** from the Command Palette.

Open a `.gtsx` file; its language mode should say **GTSX**. Hover over functions
and variables to inspect their types, use completion while writing JSX, and use
the usual TypeScript navigation and rename actions. The extension uses your
project's mapper settings, including Foldkit's classic JSX factory. For loose
files, it supplies a bundled mapper when needed.

After installing or rebuilding a project's mapper, run **GTSX: Refresh Language
Support**. If hover or completion is missing, make sure both TypeScript extensions
are enabled and run the GTSX enable command again. The **GTSX** and **TypeScript 7**
output channels show startup details. An explicitly selected TypeScript SDK must
also be **7.1 or later**.

See the [extension guide](apps/vsc-extension/README.md) for loose-file options and
more troubleshooting help.
