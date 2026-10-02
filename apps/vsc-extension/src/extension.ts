import * as vscode from 'vscode';
import { isTypeScriptNativeApi, type TypeScriptNativeApi } from './api.js';
import { resolveContentMapper } from './mapper.js';

const nativeExtensionId = 'TypeScriptTeam.native-preview';
const nightlyExtensionId = 'TypeScriptTeam.vscode-typescript-nightly';
const nativeRestartCommand = 'typescript.native-preview.restart';
let disposeActivation: (() => void) | undefined;

async function waitForNativeLanguageServer(
  api: TypeScriptNativeApi,
  signal: AbortSignal,
) {
  let subscription: vscode.Disposable | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      cancel = resolve;
      signal.addEventListener('abort', cancel, { once: true });
      timeout = setTimeout(
        () =>
          reject(
            new Error(
              'TypeScript Native Preview did not initialize within 30 seconds.',
            ),
          ),
        30_000,
      );
      // The provider also invokes this listener immediately for a ready client.
      subscription = api.onLanguageServerInitialized(resolve);
    });
  } finally {
    if (cancel) signal.removeEventListener('abort', cancel);
    clearTimeout(timeout);
    subscription?.dispose();
  }
}

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const output = vscode.window.createOutputChannel('GTSX');
  context.subscriptions.push(output);
  let registration: vscode.Disposable | undefined;
  let disposed = false;
  let warned = false;
  let warnedCompiler = false;
  let pending = Promise.resolve();
  let nativeApi: TypeScriptNativeApi | undefined;
  const activation = new AbortController();
  const dispose = () => {
    disposed = true;
    activation.abort();
    registration?.dispose();
    registration = undefined;
  };
  disposeActivation = dispose;
  context.subscriptions.push(new vscode.Disposable(dispose));

  const reportError = (error: unknown) => {
    output.appendLine(`GTSX language support failed: ${String(error)}`);
    void vscode.window.showErrorMessage(
      'GTSX language support could not start. See the GTSX output channel for details.',
    );
  };
  const register = async () => {
    if (disposed || !vscode.workspace.isTrusted) return;
    const extension = vscode.extensions.getExtension(nativeExtensionId);
    const api: unknown = await extension?.activate();
    if (disposed) return;
    if (!isTypeScriptNativeApi(api)) {
      if (!warned) {
        warned = true;
        void vscode.window.showWarningMessage(
          'GTSX requires TypeScript 7 with content mapper support. Install or update the TypeScriptTeam.native-preview extension.',
        );
      }
      return;
    }
    nativeApi = api;
    const configuredSdk = vscode.workspace
      .getConfiguration('js/ts')
      .get<unknown>('tsdk.path');
    if (typeof configuredSdk === 'string' && configuredSdk.length) {
      output.appendLine(`Configured TypeScript SDK: ${configuredSdk}`);
    }
    const manifest = extension?.packageJSON as
      { bundledTypeScriptVersion?: unknown } | undefined;
    const bundledVersion = manifest?.bundledTypeScriptVersion;
    const version =
      typeof bundledVersion === 'string'
        ? /^(\d+)\.(\d+)/.exec(bundledVersion)
        : null;
    const hasSdkOverride = [
      configuredSdk,
      vscode.workspace.getConfiguration('typescript').get<unknown>('tsdk'),
      vscode.workspace
        .getConfiguration('typescript.native-preview')
        .get<unknown>('tsdk'),
    ].some((value) => typeof value === 'string' && value.length > 0);
    if (
      !warnedCompiler &&
      !hasSdkOverride &&
      !vscode.extensions.getExtension(nightlyExtensionId) &&
      version &&
      (Number(version[1]) < 7 ||
        (Number(version[1]) === 7 && Number(version[2]) < 1))
    ) {
      warnedCompiler = true;
      const message =
        `TypeScript Native Preview bundles TypeScript ${bundledVersion}, but GTSX requires TypeScript 7.1 or later. ` +
        'Install the TypeScript 7 Nightly extension, then run GTSX: Enable TypeScript Native Language Support.';
      output.appendLine(message);
      void vscode.window.showWarningMessage(message);
    }
    const mapper = await resolveContentMapper(
      vscode.workspace.workspaceFolders ?? [],
      context.extensionUri,
      output,
    );
    if (disposed || !vscode.workspace.isTrusted) return;
    const options = vscode.workspace
      .getConfiguration('gtsx')
      .get<Record<string, unknown>>('inferredProjectOptions', {});
    const inferredOptions = { ...options };
    if (
      inferredOptions.jsxRuntime !== 'classic' &&
      inferredOptions.runtimeModule === undefined
    ) {
      inferredOptions.runtimeModule = mapper.runtimeModule;
    }
    registration?.dispose();
    registration = undefined;
    registration = api.registerContentMappers(context.extension.id, [
      {
        extensions: ['.gtsx'],
        inferredProjectContribution: {
          manifest: mapper.manifest,
          options: inferredOptions,
        },
      },
    ]);
    output.appendLine(
      `Contributed .gtsx using the ${mapper.source} mapper (${mapper.manifest.version}).`,
    );
  };
  const refresh = () => {
    pending = pending.then(register).catch(reportError);
    return pending;
  };

  context.subscriptions.push(
    vscode.workspace.onDidGrantWorkspaceTrust(() => {
      void refresh();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void refresh();
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('gtsx.inferredProjectOptions'))
        void refresh();
    }),
    vscode.commands.registerCommand('gtsx.restartLanguageSupport', refresh),
    vscode.commands.registerCommand('gtsx.enableLanguageSupport', async () => {
      if (!vscode.workspace.isTrusted) {
        void vscode.window.showWarningMessage(
          'Trust this workspace before enabling GTSX language support.',
        );
        return;
      }
      const target = vscode.workspace.workspaceFolders?.length
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
      const configuration = vscode.workspace.getConfiguration('js/ts');
      const nativeSetting = configuration.inspect<boolean>(
        'experimental.useTsgo',
      );
      // Set the command's target scope explicitly: a legacy typescript.*
      // setting in this workspace can override an inherited js/ts.* value.
      const nativeEnabled =
        (target === vscode.ConfigurationTarget.Workspace
          ? nativeSetting?.workspaceValue
          : nativeSetting?.globalValue) === true;
      const mappersEnabled =
        configuration.get('contentMappers.enabled') === true;
      // Queue the contribution before enabling the provider. Native Preview
      // owns startup/restart when these settings change.
      await refresh();
      if (disposed || !vscode.workspace.isTrusted) return;
      if (!mappersEnabled)
        await configuration.update('contentMappers.enabled', true, target);
      if (disposed || !vscode.workspace.isTrusted) return;
      if (!nativeEnabled)
        await configuration.update('experimental.useTsgo', true, target);
      if (disposed || !vscode.workspace.isTrusted) return;
      if (!nativeEnabled || !mappersEnabled || !nativeApi) return;
      // With unchanged settings, restart to pick up a newly installed Nightly.
      // The restart command is registered before its language client exists.
      await waitForNativeLanguageServer(nativeApi, activation.signal);
      if (disposed || !vscode.workspace.isTrusted) return;
      const commands = await vscode.commands.getCommands(true);
      if (
        !disposed &&
        vscode.workspace.isTrusted &&
        commands.includes(nativeRestartCommand)
      ) {
        await vscode.commands.executeCommand(nativeRestartCommand);
      }
    }),
  );
  await refresh();
}

export function deactivate(): void {
  disposeActivation?.();
  disposeActivation = undefined;
}
