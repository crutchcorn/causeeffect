# GTSX for Visual Studio Code

TypeScript language support for **`.gtsx`** generator components: hover types,
completion, diagnostics, definitions, references, and rename. JSX expressions
retain the component's yield, return, and next types.

```tsx
// example.gtsx
function* Test() {
  yield 123;
  return <p>Hello</p>;
}

const Result = <Test />;
// JSX.GeneratorElement<number, JSX.GeneratorElement<never, never, never>, unknown>
```

TypeScript infers `unknown` for this generator's next parameter. An explicit
`Generator<Yield, Return, Next>` annotation preserves all three parameters,
including `never` when requested. The mapper also preserves yielded Effect v4
types; `packages/jsx-content-mapper/README.md` in the repository documents the
mapper and Effect examples.

## Install and enable

Requires **VS Code 1.126 or later** and the
[TypeScript Native Preview extension](https://marketplace.visualstudio.com/items?itemName=TypeScriptTeam.native-preview)
(`TypeScriptTeam.native-preview`). Its current content mapper API is experimental;
this extension is verified with Native Preview **1.0.1** and TypeScript
**7.1.0-dev.20261002.1**. Update Native Preview if GTSX reports an unsupported API.

From the repository root:

```sh
pnpm install
pnpm --filter causeeffect-gtsx package
code --install-extension apps/vsc-extension/dist/gtsx.vsix
```

Trust the workspace, open a `.gtsx` file, and run
**GTSX: Enable TypeScript Native Language Support** from the Command Palette.
The command enables these settings in the current workspace, or in user settings
when no workspace is open:

```json
{
  "js/ts.experimental.useTsgo": true,
  "js/ts.contentMappers.enabled": true
}
```

Activation itself leaves settings unchanged. Untrusted workspaces get syntax
highlighting; starting mapper processes requires workspace trust and enabled
content mappers. Virtual workspaces are unsupported. The **GTSX** output channel
reports the selected mapper and startup failures.

## Projects and loose files

Projects with `tsconfig.json` install and configure their own mapper:

```sh
pnpm add @causeeffect/jsx-content-mapper
```

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

The extension registers the file extension with the native language service;
configured projects use their own package and mapper options. Use the same options
in the build tool; language support does not emit application JavaScript.

Loose files work without installing the mapper. For one local workspace folder,
the extension prefers a valid installed `@causeeffect/jsx-content-mapper` and
falls back to its bundled copy. With no folder or multiple folders, it uses the
bundled copy. TypeScript allows one inferred mapper registration per extension
across the window, so multiple workspace folders share this fallback. Their
configured projects can still use different installed mapper versions.

Set `gtsx.inferredProjectOptions` to customize loose files:

```json
{
  "gtsx.inferredProjectOptions": {
    "jsxRuntime": "classic",
    "jsxFactory": "jsx.createElement",
    "jsxFragmentFactory": "jsx.Fragment"
  }
}
```

The default is generator mode with the selected mapper's runtime. To use a future
framework runtime, set `runtimeModule` instead. In a configured project, put these
options on the `contentMappers` entry in `tsconfig.json`. Run
**GTSX: Refresh Language Support** after installing or rebuilding a workspace
mapper; changing inferred options or workspace folders refreshes automatically.

## Development

```sh
pnpm --filter causeeffect-gtsx build
pnpm --filter causeeffect-gtsx typecheck
pnpm --filter causeeffect-gtsx test
pnpm --filter causeeffect-gtsx lint
code --extensionDevelopmentPath="$PWD/apps/vsc-extension"
```

The build compiles the existing mapper, bundles the extension and mapper process
with esbuild, and copies the runtime and its declarations. The VSIX contains these
artifacts and dependency license notices; it does not require repository symlinks
or a separate Node installation for inferred projects. Workspace-installed mappers
in configured projects retain their own executable requirements.

Tests exercise activation, trust, disposal, options, and mapper resolution. Native
LSP integration tests start the pinned TypeScript 7.1 compiler and check generator
hover types, `.gtsx` definitions, Unicode diagnostic ranges, edits, and rename in
both configured and inferred projects.
They also check the Foldkit example's classic factory while a generator fallback
is registered, including mapped diagnostics after an edit and its restoration.

For a real VS Code extension host smoke test, install Native Preview locally and
run:

```sh
CODE_BINARY=code \
NATIVE_EXTENSION_PATH=/path/to/typescriptteam.native-preview-extension \
pnpm --filter causeeffect-gtsx test:host
```

The host test uses temporary settings, extensions, and workspace directories.

## Integration

The extension calls the native provider's
[`registerContentMappers`](https://github.com/microsoft/TypeScript/blob/main/packages/vscode-typescript/src/extension.ts)
API using its current
[`inferredProjectContribution` manifest](https://github.com/microsoft/TypeScript/blob/main/packages/vscode-typescript/src/contentMapperContributions.ts).
The native language service handles LSP transport, project discovery, and mapped
positions through the implementation introduced in
[typescript-go#4712](https://github.com/microsoft/typescript-go/pull/4712).
The existing mapper uses Babel and `ts-content-mapper`; syntax highlighting reuses
VS Code's TypeScript React grammar.
