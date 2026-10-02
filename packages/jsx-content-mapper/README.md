# @causeeffect/jsx-content-mapper

A [TypeScript 7.1 content mapper](https://github.com/sxzz/ts-content-mapper) for
generator components written in **`.gtsx`** files. Babel parses TypeScript and JSX;
the mapper lowers JSX to ordinary calls so every expression retains its own type.
The SDK supplies the server protocol and UTF-8/UTF-16 source mappings.

```tsx
// example.gtsx
import type { JSX } from '@causeeffect/jsx-content-mapper/runtime';

function* Test() {
  yield 123;
  return <p>Hello</p>;
}

export const Result = <Test />;
// JSX.GeneratorElement<
//   number,
//   JSX.GeneratorElement<never, never, never>,
//   unknown
// >
```

TypeScript infers `unknown` for the next type of this unannotated generator. The
mapper preserves it instead of converting it to `never`. An explicit
`Generator<Yield, Return, Next>` annotation retains all three parameters exactly,
including a `never` next type when that is intended.

## Setup

Requires Node.js `^22.18.0 || >=24.11.0` and a TypeScript 7.1 nightly supporting
content mappers. The tests pin `7.1.0-dev.20261002.1`; the upstream protocol is
experimental. Stable TypeScript 6 builds the mapper itself.

Install this package in the consuming project and use a nightly compiler:

```sh
pnpm add @causeeffect/jsx-content-mapper
pnpm add -D typescript@7.1.0-dev.20261002.1
```

The consuming `tsconfig.json` registers the **`.gtsx`** extension at the top level:

```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true
  },
  "contentMappers": [
    {
      "package": "@causeeffect/jsx-content-mapper",
      "extensions": [".gtsx"]
    }
  ],
  "include": ["src"]
}
```

```sh
pnpm exec tsc --noEmit --runExternalCode
```

`--runExternalCode` lets TypeScript start the mapper's Node process. No `jsx`
compiler option or JSX factory setting is necessary: its virtual file is `.ts`.
Imports between `.gtsx` files are supported, including `./component.gtsx`.

## Types and runtime

JSX such as `<Greeting<string> name="Ada" />` lowers to:

```ts
createComponent(Greeting<string>({ name: 'Ada' }));
```

TypeScript checks the actual call, preserving generic arguments, overloaded
component signatures, contextual callback types, required props, and the
component's return type. Attributes, spreads, and child expressions are evaluated
in their original lexical context, including `yield` and `await`. JSX text and
entities follow Babel's semantics. A single child becomes `props.children`; two or
more become an array. Children override a `children` attribute or spread, as in
conventional JSX. Fragments and intrinsic tags are supported; JSX spread children
(`{...children}`) produce a diagnostic, so use `{children}` instead.

The default runtime exports:

- `JSX.GeneratorElement<Yield, Return, Next>`: a typed description retaining all
  three generator channels.
- `createComponent(value)`: wraps a synchronous or asynchronous generator,
  retaining its parameters. Ordinary return values use
  `GeneratorElement<never, Return, never>`.
- `createElement(tag, props)` and `Fragment`: create intrinsic/fragment descriptions
  with `GeneratorElement<never, never, never>`.

JSX without attributes or rendered children calls the component with no arguments:
`<Test />` becomes `createComponent(Test())`. A component that accepts an object
with optional properties should default the parameter, such as
`function* Greeting(props: { name?: string } = {})`. Otherwise a no-argument call
is a TypeScript error. Components with attributes or children receive a props object.

Generator components create their iterator at the JSX expression; their bodies
remain suspended until a framework advances it. Ordinary components execute at
the expression. Component descriptions expose `kind: 'component'` and `value`;
intrinsic/fragment descriptions expose `kind`, `type`, and `props`. Descriptions
and intrinsic prop snapshots are shallowly frozen.

These are building blocks for a renderer. Intrinsic attributes are deliberately
permissive, intrinsic/fragment types do not aggregate child generator channels,
and the runtime does not execute effects or render DOM nodes. A future framework
can supply its own runtime via mapper options:

```json
{
  "contentMappers": [
    {
      "package": "@causeeffect/jsx-content-mapper",
      "extensions": [".gtsx"],
      "options": { "runtimeModule": "my-framework/gtsx-runtime" }
    }
  ]
}
```

That module must export `createElement`, `createComponent`, and `Fragment` with
the same calling convention. It can specialize element types and intrinsic props.

## Effect v4

Effect is a development dependency only. The mapper keeps the actual yielded
Effect, including its error and service types, available for a future Effect
renderer:

```tsx
import { Effect } from 'effect';

interface Failure {
  readonly reason: string;
}
interface Database {
  readonly query: string;
}
declare const query: Effect.Effect<string, Failure, Database>;

function* View() {
  const message = yield* query;
  return <p>{message}</p>;
}

const view = <View />;
// JSX.GeneratorElement<
//   Effect.Effect<string, Failure, Database>,
//   JSX.GeneratorElement<never, never, never>,
//   any
// >

const program = Effect.gen(View);
// Effect.Effect<JSX.GeneratorElement<never, never, never>, Failure, Database>
```

The `any` next type comes from Effect v4's iterator protocol and is preserved too.
The integration tests compile this pattern against Effect **4.0.0**. Effect types
may require `"lib": ["es2022", "esnext.disposable"]` in the consuming configuration.

## JavaScript builds and declarations

TypeScript's current content mapper implementation
[does not emit JavaScript for mapped files](https://github.com/microsoft/typescript-go/pull/4712).
It can check them and emit declarations, named `example.d.gtsx.ts`, plus
declaration maps pointing to the original `.gtsx` file.

Use the public transform in a build-tool integration, then transpile the returned
TypeScript with TypeScript, Babel, SWC, or another TypeScript-aware tool:

```ts
import { transformGtsx } from '@causeeffect/jsx-content-mapper';

const output = transformGtsx(source, { fileName: 'example.gtsx' });
// output.text: ordinary TypeScript, with an imported runtime and no JSX
// output.extension: '.ts'
// output.mappings: compact content-mapper protocol spans, not a Source Map v3
// output.diagnostics: parser/unsupported-syntax diagnostics when present
```

Check diagnostics before transpiling, and resolve `.gtsx` imports in the build-tool
integration. The integration tests separately compile the virtual `.ts` output and
execute it to verify runtime behavior.

## Working in this repository

```sh
pnpm install
pnpm --filter @causeeffect/jsx-content-mapper build
pnpm --filter @causeeffect/jsx-content-mapper typecheck
pnpm --filter @causeeffect/jsx-content-mapper test
pnpm --filter @causeeffect/jsx-content-mapper lint
```

Tests cover runtime behavior, JSX semantics and source mappings, plus actual
TypeScript 7.1 mapper discovery, `.gtsx` imports, declaration emit, original-source
diagnostics, generator generics, and Effect v4 compatibility. They build the mapper
before invoking the nightly compiler; no global nightly installation is needed.
