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

Use the Node version in `.nvmrc` and PNPM 12 for this workspace. CI reads Node from
that file and PNPM from the root `packageManager` field. Install dependencies
from the repository root:

```sh
nvm install
nvm use
pnpm install
```

The mapper requires Node.js `^22.18.0 || >=24.11.0`. Package builds use stable
TypeScript 6.0.3; `.gtsx` checks use the pinned TypeScript
`7.1.0-dev.20261002.1` nightly through the `typescript-next` alias. Content mappers
are experimental and currently require TypeScript 7.1. Keep the explicit
compiler paths in package scripts so the stable and nightly executables do not
get mixed up. The example and integration tests use Effect 4.0.0.

## Checks

Root commands use Nx to order dependencies and cache project checks:

```sh
pnpm build
pnpm typecheck
pnpm test
pnpm lint
pnpm format
pnpm format:check
pnpm check
```

`pnpm test` runs all regular Vitest suites.
`pnpm lint` runs ESLint for the root, both libraries, and the extension, plus
Zizmor for GitHub Actions. Examples are excluded from ESLint. Install
[Zizmor](https://docs.zizmor.sh/installation/) to run `pnpm lint`, `pnpm lint:ci`,
or `pnpm check` locally; CI uses a dedicated, pinned Zizmor action.
Formatting includes `.gtsx` sources and ignores generated output and the PNPM lockfile.

For changes relative to `main`, run only affected projects:

```sh
pnpm affected --base=main --head=HEAD
```

Nx uses the existing package scripts instead of inferring compiler commands
from Vite or TypeScript configuration. This keeps the stable and nightly
compiler paths explicit and lets the graph load before library builds exist.
The extension also depends on the Foldkit adapter and example fixtures, so
changes to those projects rerun its language-server integration tests.

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
Foldkit example, including its classic JSX options. The Vitest host smoke test requires
a local VS Code installation, TypeScript Native Preview, and TypeScript 7 Nightly;
it uses the installed Nightly compiler without an SDK override and invokes the
actual Enable command in temporary settings and workspace directories.
Package the VSIX after tests because test
setup rebuilds the extension's `dist` directory.

The root `pnpm test:host` command runs this separate suite through Nx. Its target
is uncached and runs after the regular extension suite. CI provisions VS Code
and both required extensions, and runs the host test when Nx marks the extension
affected.

## CI and npm releases

Pull requests targeting `main` and merge queues run the reusable CI workflow.
It runs formatting, ESLint, typechecks, Vitest, and builds for affected projects,
using `main` as the base branch and the last successful main run when available.
Zizmor checks every workflow in a dedicated job with pedantic, offline audits. A push to `main`
invokes the same CI from `publish.yml` before running Changesets.

Only `@causeeffect/jsx-content-mapper` and `@causeeffect/foldkit-jsx` publish to
npm. For changes that should release either library, add a changeset to the PR:

```sh
pnpm changeset
pnpm changeset:status
```

Choose the affected packages, bump types, and a changelog summary. Commit the
generated `.changeset/*.md` file with the change; do not bump package versions
manually. Build tooling and documentation changes that do not require a package
release do not need a changeset. Private applications and examples are excluded
from versioning and publishing.

The Changesets action creates or updates a release PR when changesets reach
`main`. It consumes those files, updates package versions and changelogs, and
refreshes the PNPM lockfile through `pnpm release:version`. Merging the release
PR runs CI and builds through Nx, then `pnpm release:publish` publishes missing
versions using Changesets and GitHub OIDC through PNPM's native publisher.
For a read-only registry preview:

```sh
pnpm release:plan
```

The repository has **Actions → General → Allow GitHub Actions to create and
approve pull requests** enabled. Release PRs created with `GITHUB_TOKEN`
do not trigger ordinary PR workflows, so the version job explicitly dispatches
CI on the release branch. CI can also be dispatched manually.

Before the first automated release, configure an
[npm trusted publisher](https://docs.npmjs.com/trusted-publishers/) for each library:

- GitHub owner: `crutchcorn`
- Repository: `causeeffect`
- Workflow filename: `publish.yml`
- GitHub environment: `npm`
- Allowed action: direct `npm publish`

The workflow uses the `npm` GitHub environment, restricted to the `main` branch.
npm requires packages to exist before configuring their
trusted publisher; unpublished packages need an initial maintainer publication.
From an authenticated maintainer session, build and bootstrap them with:

```sh
pnpm build
npm publish ./packages/jsx-content-mapper --access=public --provenance=false
npm publish ./packages/foldkit-jsx --access=public --provenance=false
```

Local bootstrap publications disable provenance; subsequent GitHub OIDC releases
generate it. The workflow uses the pinned Node and PNPM versions and grants
`id-token: write` only to its publishing job.

When incremental commits are requested, commit coherent completed changes as
the work progresses. Include only the files belonging to the task.
