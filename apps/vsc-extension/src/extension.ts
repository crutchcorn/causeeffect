import * as vscode from 'vscode';
import { isTypeScriptNativeApi } from './api.js';
import { resolveContentMapper } from './mapper.js';

const nativeExtensionId = 'TypeScriptTeam.native-preview';
let disposeActivation: (() => void) | undefined;

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const output = vscode.window.createOutputChannel('GTSX');
  context.subscriptions.push(output);
  let registration: vscode.Disposable | undefined;
  let disposed = false;
  let warned = false;
  let pending = Promise.resolve();
  const dispose = () => {
    disposed = true;
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
      `Registered .gtsx using the ${mapper.source} mapper (${mapper.manifest.version}).`,
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
      await configuration.update('experimental.useTsgo', true, target);
      await configuration.update('contentMappers.enabled', true, target);
      await refresh();
    }),
  );
  await refresh();
}

export function deactivate(): void {
  disposeActivation?.();
  disposeActivation = undefined;
}
