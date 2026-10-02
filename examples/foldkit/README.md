# Foldkit with `.gtsx` Views and Submodels

A runnable Foldkit application using the TypeScript 7.1 content mapper and a
separate, Foldkit-specific JSX adapter. Both the application View and reusable
counter Submodel live in `.gtsx` files. Two instances have independent state and
message boundaries; a parent action resets both through their child updates.

From the repository root:

```sh
pnpm install
pnpm --filter @causeeffect/foldkit-example dev
```

Vite prints the local URL. The example pins Foldkit `0.165.0`, Effect `4.0.0`, and
the TypeScript `7.1.0-dev.20261002.1` nightly.

The example's `dev`, `build`, `typecheck`, and `test` scripts build their workspace
dependencies first, so they work from a clean checkout immediately after install.

```sh
pnpm --filter @causeeffect/foldkit-example typecheck
pnpm --filter @causeeffect/foldkit-example test
pnpm --filter @causeeffect/foldkit-example build
```

The typecheck runs the actual nightly compiler with `--runExternalCode` so it
can start the content mapper. Vite uses the same transformation options for
browser builds and Vitest. The Scene tests click the rendered counter controls
and verify child message routing and parent resets without requiring a DOM.
Four additional tests invoke TypeScript 7.1 against invalid `.gtsx` fixtures and
verify source locations and contextual callback types for direct attributes,
messages, Submodel configurations, and component props and children.

This example uses ordinary Vite reloads. Foldkit's optional
`@foldkit/vite-plugin` can be added for Model preservation across source reloads.

## Views

Foldkit supplies each View's Message-typed `h` builder. Bind the adapter inside
that View:

```tsx
import { createJsx } from '@causeeffect/foldkit-jsx';

export const view = (model: Model, h: HtmlBuilder<Message>): Document => {
  const jsx = createJsx(h);

  return {
    title: `Count: ${model.count}`,
    body: (
      <button OnClick={Message.ClickedIncrement()} Class="increment">
        {model.count}
      </button>
    ),
  };
};
```

Write Foldkit helper names directly as JSX props. The adapter turns
`OnClick={message}` into `h.OnClick(message)`, `Class="increment"` into
`h.Class('increment')`, and `AriaLabel="Increment"` into
`h.AriaLabel('Increment')`. Prop names match the helpers on `HtmlBuilder<Message>`
exactly, and their value types come from the helper signatures. The View's
Message type checks the event values, and Foldkit dispatches them through that
View's boundary.

Use `attributes` for helpers that require multiple arguments, such as
`h.OnCutText`, `h.DataAttribute`, and `h.Attribute`, or event options:

```tsx
<button attributes={[h.OnClick(message, { defaultAction: 'Prevent' })]}>
  Reset
</button>
```

JSX creates ordinary Foldkit `Html`, so root Views keep returning a Foldkit
`Document` and child Views keep returning `Html`.

## Submodels

[`src/counter.gtsx`](src/counter.gtsx) uses
`Submodel.defineView<Model, Message, ViewInputs>` unchanged. It builds its own
`createJsx(h)` factory and owns its Model, Message union, and update function.

The parent embeds the branded child View with the adapter's component:

```tsx
<jsx.Submodel
  slotId="left"
  model={model.left}
  view={Counter.view}
  viewInputs={{ label: 'Left counter' }}
  toParentMessage={(message) =>
    Message.GotCounterMessage({
      counterId: 'left',
      message,
    })
  }
/>
```

This delegates to `h.submodel`, retaining Foldkit's instance boundaries and
Message typing. The parent routes wrappers into `Update.foldChild`; it does not
write the counter's state directly. Parent-driven resets call `Counter.reset`
through `Update.foldChildStep` and compose the two steps with `Update.combine`.

The example follows Foldkit's [View](https://foldkit.dev/core/view),
[Submodel](https://foldkit.dev/core/submodel), and
[Runtime](https://foldkit.dev/core/runtime) contracts.

## Framework-neutral mapping

The content mapper has no dependency on Foldkit. Both `tsconfig.json` and
`vite.config.mts` select a conventional classic JSX transformation:

```json
{
  "jsxRuntime": "classic",
  "jsxFactory": "jsx.createElement",
  "jsxFragmentFactory": "jsx.Fragment"
}
```

For example,
`<button OnClick={Message.ClickedReset()} Class="reset">Reset</button>` maps to
`jsx.createElement('button', { OnClick: Message.ClickedReset(), Class: 'reset' }, 'Reset')`.
The lexical factory comes from `@causeeffect/foldkit-jsx`, which converts the props
into Foldkit attributes. The mapper passes props through without knowing about
Foldkit. Babel parses the JSX and the mapper retains source locations for compiler
diagnostics.

Foldkit Views are pure synchronous functions, so this example uses ordinary
Views rather than running generators during rendering. The mapper's default
generator-preserving runtime remains available independently.
