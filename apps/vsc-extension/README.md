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
types; the [mapper guide](https://github.com/crutchcorn/causeeffect/blob/main/packages/jsx-content-mapper/README.md)
documents the runtime and Effect examples.

## Install and enable

Requires **VS Code 1.126 or later** and the
[TypeScript Native Preview extension](https://marketplace.visualstudio.com/items?itemName=TypeScriptTeam.native-preview)
(`TypeScriptTeam.native-preview`) plus
[TypeScript 7 Nightly](https://marketplace.visualstudio.com/items?itemName=TypeScriptTeam.vscode-typescript-nightly)
(`TypeScriptTeam.vscode-typescript-nightly`). GTSX declares both as extension
dependencies. Native Preview **1.0.1** bundles TypeScript **7.0.2**, which does not
support content mappers; Nightly supplies the required **7.1** compiler. The API
is experimental, and the compiler integration tests pin **7.1.0-dev.20261002.1**.
Update Native Preview if GTSX reports an unsupported API.

Install [GTSX from the Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=CauseEffect.causeeffect-gtsx),
or use the extension's ID with the VS Code CLI:

```sh
code --install-extension CauseEffect.causeeffect-gtsx
```

Install and enable both TypeScript extensions above. For packaging GTSX from
source, see the
[contributor guide](https://github.com/crutchcorn/causeeffect/blob/main/AGENTS.md).

Trust the workspace, open a `.gtsx` file, and run
**GTSX: Enable TypeScript Native Language Support** from the Command Palette.
The command enables these settings in the current workspace, or in user settings
when no workspace is open. Native Preview starts automatically when the settings
change. If both settings are already enabled, the command waits for the language
server to initialize before restarting it to pick up Nightly:

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

If hover and other language actions are missing, check the **TypeScript 7** output
channel. An `unknown method 'custom/setContentMapperContributions'` error means
the selected compiler is too old. Install TypeScript 7 Nightly and run the GTSX
enable command again. Explicit `js/ts.tsdk.path` settings and selected workspace
SDKs take precedence over Nightly; they must also point to TypeScript **7.1 or
later**. Use **TypeScript: Select TypeScript Version** from a `.ts` file to select
**Use TypeScript 7**, or configure the project's 7.1 SDK. The GTSX extension keeps
explicit SDK settings intact.

## Projects and loose files

Projects with `tsconfig.json` install and configure their own mapper from npm:

```sh
npm install @causeeffect/jsx-content-mapper
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
in the build tool; language support does not emit application JavaScript. The
[mapper setup guide](https://github.com/crutchcorn/causeeffect/blob/main/packages/jsx-content-mapper/README.md#setup)
covers installing the CLI compiler and runtime, and the
[Foldkit JSX guide](https://github.com/crutchcorn/causeeffect/blob/main/packages/foldkit-jsx/README.md#setup)
covers Foldkit's classic factory configuration.

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

The VSIX bundles the extension, mapper process, runtime declarations, and
dependency license notices. Loose files do not need a separate Node installation.
Workspace-installed mappers in configured projects require Node.js
`^22.18.0 || >=24.11.0`.

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
