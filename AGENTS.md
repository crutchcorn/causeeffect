# Contributor guide

## Project layout

- `packages/jsx-content-mapper` implements framework-independent `.gtsx` mapping,
  the generator-preserving runtime, the TypeScript content mapper server, and the
  Vite plugin.
- `packages/foldkit-jsx` adapts Foldkit's typed HTML builders to a classic JSX
  factory. Foldkit-specific behavior belongs here.
- `examples/foldkit` is the runnable application demonstrating `.gtsx` Views and
  Submodels.
- `apps/vsc-extension` registers `.gtsx` with TypeScript Native Preview and
  bundles a mapper for loose files. Configured projects keep their own mapper
  package and options.

Keep the root README focused on users: what the project does, a small example,
and setup. Put contributor instructions here and detailed package API guidance
in the package READMEs.

## Implementation conventions

- Use Babel's TypeScript/JSX parser and JSX child normalization. Do not introduce
  a handwritten JSX parser.
- Preserve all generator type parameters, including TypeScript's inferred
  `unknown` or Effect's `any` next type. Do not replace them with `never`.
- Keep the mapper independent of Foldkit. Its classic mode emits configurable
  `factory(tag, props, ...children)` calls; framework adapters interpret props.
- Derive Foldkit prop types and constructors from `HtmlBuilder<Message>` rather
  than copying an attribute table. Prop names use Foldkit's exact casing, such
  as `OnClick`, `Class`, and `AriaLabel`.
- Bind `createJsx(h)` inside each View using that View's builder. Retain Foldkit's
  typed Submodel boundaries and message routing.
- Keep the Vite and TypeScript content mapper options in sync. Changes to mapped
  code must preserve diagnostics and source locations in the original `.gtsx`
  files.

## Toolchain

Use PNPM 10 for this workspace. Install dependencies from the repository root:

```sh
pnpm install
```

The mapper requires Node.js `^22.18.0 || >=24.11.0`. Package builds use stable
TypeScript 6.0.3; `.gtsx` checks use the pinned TypeScript
`7.1.0-dev.20261002.1` nightly through the `typescript-next` alias. Content mappers
are experimental and currently require TypeScript 7.1. Keep the explicit
compiler paths in package scripts so the stable and nightly executables do not
get mixed up. The example and integration tests use Effect 4.0.0.

## Checks

Run checks appropriate to the files and behavior changed. For either library,
replace the package name below with `@causeeffect/foldkit-jsx` when working on
the adapter:

```sh
pnpm --filter @causeeffect/jsx-content-mapper build
pnpm --filter @causeeffect/jsx-content-mapper typecheck
pnpm --filter @causeeffect/jsx-content-mapper test
pnpm --filter @causeeffect/jsx-content-mapper lint
```

Mapper tests include native TypeScript 7.1 integration checks as well as runtime,
mapping, and Vite tests. Adapter tests check both Foldkit behavior and compile-time
contracts. For changes affecting the `.gtsx` application or its integration, use:

```sh
pnpm --filter @causeeffect/foldkit-example typecheck
pnpm --filter @causeeffect/foldkit-example test
pnpm --filter @causeeffect/foldkit-example build
```

The example scripts build both workspace libraries first. Its typecheck invokes
the nightly compiler with `--runExternalCode`, allowing it to start the mapper.
The example tests include Foldkit Scene interactions and invalid `.gtsx` type
fixtures. Start the browser example with:

```sh
pnpm --filter @causeeffect/foldkit-example dev
```

Format changed files with Prettier and check documentation-only changes without
running unrelated application tests:

```sh
pnpm exec prettier --write <changed-files>
pnpm exec prettier --check <changed-files>
git diff --check
```

For extension changes, run:

```sh
pnpm --filter causeeffect-gtsx typecheck
pnpm --filter causeeffect-gtsx test
pnpm --filter causeeffect-gtsx lint
pnpm --filter causeeffect-gtsx test:host
pnpm --filter causeeffect-gtsx package
```

The extension's native LSP tests cover generator projects and the configured
Foldkit example, including its classic JSX options. The host smoke test requires
a local VS Code installation, TypeScript Native Preview, and TypeScript 7 Nightly;
it uses the installed Nightly compiler without an SDK override and invokes the
actual Enable command in temporary settings and workspace directories.
Package the VSIX after tests because test
setup rebuilds the extension's `dist` directory.

When incremental commits are requested, commit coherent completed changes as
the work progresses. Include only the files belonging to the task.
