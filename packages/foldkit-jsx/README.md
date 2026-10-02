# @causeeffect/foldkit-jsx

`@causeeffect/foldkit-jsx` adapts a [Foldkit view](https://foldkit.dev/core/view)'s typed `HtmlBuilder` to a classic JSX factory. Foldkit remains responsible for HTML, event handlers, dispatch boundaries, and [Submodels](https://foldkit.dev/core/submodel). The content mapper only translates JSX syntax into configurable factory calls.

## Setup

In your application's directory, install the adapter and Foldkit's runtime
dependencies:

```sh
npm install @causeeffect/foldkit-jsx foldkit@0.165.0 effect@4.0.0 @effect/platform-browser@4.0.0
npm install --save-dev @causeeffect/jsx-content-mapper vite@^8.1.4
npm install --save-dev --save-exact typescript@7.1.0-dev.20261002.1
```

This setup requires Node.js `^22.18.0 || >=24.11.0`. TypeScript 7.1 content mappers
are experimental; stable TypeScript cannot check `.gtsx` files yet. The pinned
nightly above is the version used by the example and integration tests.
`@effect/platform-browser` supplies the browser services used by Foldkit's
application runtime.

## Configure `.gtsx`

Create `tsconfig.json` in your application:

```json
{
  "compilerOptions": {
    "target": "es2022",
    "lib": ["es2022", "dom", "esnext.disposable"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vite/client"]
  },
  "contentMappers": [
    {
      "package": "@causeeffect/jsx-content-mapper",
      "extensions": [".gtsx"],
      "options": {
        "jsxRuntime": "classic",
        "jsxFactory": "jsx.createElement",
        "jsxFragmentFactory": "jsx.Fragment"
      }
    }
  ],
  "include": ["src"]
}
```

Create `vite.config.mts` with the same JSX options:

```ts
import { gtsx } from '@causeeffect/jsx-content-mapper/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    gtsx({
      jsxRuntime: 'classic',
      jsxFactory: 'jsx.createElement',
      jsxFragmentFactory: 'jsx.Fragment',
    }),
  ],
});
```

Classic mode uses the factory expression in your file's scope. It does not inject
a runtime import. Both TypeScript and Vite must use these classic options; the
mapper's default generator runtime produces a different kind of element. The
[mapper guide](https://github.com/crutchcorn/causeeffect/blob/main/packages/jsx-content-mapper/README.md)
documents the transformation and available options.

Add scripts to your application's `package.json`:

```json
{
  "type": "module",
  "scripts": {
    "dev": "vite",
    "typecheck": "tsc --noEmit --runExternalCode",
    "build": "npm run typecheck && vite build",
    "preview": "vite preview"
  }
}
```

`--runExternalCode` allows TypeScript to start the mapper's Node process. Vite
transforms `.gtsx` for the browser, while the `typecheck` script checks the
original files. No `jsx` compiler option is required.

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

## Run your application

Keep Foldkit's normal Model, init, and update functions, and export your JSX View
from `src/app.gtsx`. Start the application from `src/main.ts`:

```ts
import { Runtime } from 'foldkit';
import { Model, init, update, view } from './app.gtsx';

const container = document.getElementById('root');
if (!container) throw new Error('The application container is missing.');

Runtime.run(Runtime.makeApplication({ Model, init, update, view, container }));
```

Add the container and module entry point to your root `index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Foldkit with GTSX</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

Check the app and start Vite from your application directory:

```sh
npm run typecheck
npm run dev
```

Open the URL Vite prints. Use `npm run build` to check and bundle the app, then
`npm run preview` to serve that build locally.

For complete Model, Message, update, and Submodel implementations, see the
[runnable Foldkit example](https://github.com/crutchcorn/causeeffect/tree/main/examples/foldkit),
including its
[application View](https://github.com/crutchcorn/causeeffect/blob/main/examples/foldkit/src/app.gtsx)
and
[counter Submodel](https://github.com/crutchcorn/causeeffect/blob/main/examples/foldkit/src/counter.gtsx).
The
[VS Code extension guide](https://github.com/crutchcorn/causeeffect/blob/main/apps/vsc-extension/README.md)
explains how to enable hover types, completion, diagnostics, and navigation for
your `.gtsx` files.
