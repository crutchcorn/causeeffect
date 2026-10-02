import type * as VSCode from 'vscode';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => {
  function event() {
    const listeners = new Set<(value?: unknown) => unknown>();
    return {
      listeners,
      register: vi.fn((listener: (value?: unknown) => unknown) => {
        listeners.add(listener);
        return { dispose: vi.fn(() => listeners.delete(listener)) };
      }),
      async emit(value?: unknown) {
        await Promise.all([...listeners].map((listener) => listener(value)));
      },
    };
  }
  function uri(path: string) {
    return {
      scheme: 'file',
      fsPath: path,
      path,
      toString: () => `file://${path}`,
    };
  }
  const registrationDisposals: ReturnType<typeof vi.fn>[] = [];
  const registerContentMappers = vi.fn<
    (...args: unknown[]) => { dispose(): void }
  >(() => {
    const dispose = vi.fn();
    registrationDisposals.push(dispose);
    return { dispose };
  });
  const nativeInitialized = event();
  const onLanguageServerInitialized = vi.fn((listener: () => void) => {
    listener();
    return nativeInitialized.register(listener);
  });
  const nativeApi = { registerContentMappers, onLanguageServerInitialized };
  const nativeExtension = {
    id: 'TypeScriptTeam.native-preview',
    isActive: true,
    exports: nativeApi as unknown,
    activate: vi.fn(async (): Promise<unknown> => nativeExtension.exports),
    packageJSON: { bundledTypeScriptVersion: '7.0.2' },
  };
  const nightlyExtension = {
    id: 'TypeScriptTeam.vscode-typescript-nightly',
    isActive: true,
    exports: undefined as unknown,
    activate: vi.fn(async (): Promise<unknown> => undefined),
    packageJSON: {
      version: '0.20261002.1',
      bundledTypeScriptVersion: '7.1.0-dev.20261002.1',
    },
  };
  const settings = new Map<string, unknown>();
  const globalSettings = new Map<string, unknown>();
  const update = vi.fn<
    (
      section: string,
      key: string,
      value: unknown,
      target?: unknown,
    ) => Promise<void>
  >(async (section, key, value) => {
    settings.set(`${section}.${key}`, value);
  });
  const commands = new Map<string, (...args: unknown[]) => unknown>();
  const output = {
    appendLine: vi.fn(),
    show: vi.fn(),
    dispose: vi.fn(),
  };
  return {
    uri,
    settings,
    globalSettings,
    update,
    commands,
    output,
    registrationDisposals,
    nativeExtension,
    nightlyExtension,
    nativeApi,
    registerContentMappers,
    nativeInitialized,
    onLanguageServerInitialized,
    getExtension:
      vi.fn<
        (
          id: string,
        ) => typeof nativeExtension | typeof nightlyExtension | undefined
      >(),
    getCommands: vi
      .fn<(...args: unknown[]) => Promise<string[]>>()
      .mockResolvedValue(['typescript.native-preview.restart']),
    registerCommand: vi.fn(
      (name: string, callback: (...args: unknown[]) => unknown) => {
        commands.set(name, callback);
        return { dispose: vi.fn(() => commands.delete(name)) };
      },
    ),
    showWarningMessage: vi
      .fn<(...args: unknown[]) => Promise<undefined>>()
      .mockResolvedValue(undefined),
    showInformationMessage: vi
      .fn<(...args: unknown[]) => Promise<undefined>>()
      .mockResolvedValue(undefined),
    showErrorMessage: vi
      .fn<(...args: unknown[]) => Promise<undefined>>()
      .mockResolvedValue(undefined),
    executeCommand: vi
      .fn<(...args: unknown[]) => Promise<undefined>>()
      .mockResolvedValue(undefined),
    configurationChanged: event(),
    foldersChanged: event(),
    trustGranted: event(),
    extensionsChanged: event(),
    isTrusted: true,
    folders: [{ name: 'project', index: 0, uri: uri('/project') }],
    resolved: {
      manifest: {
        name: '@causeeffect/jsx-content-mapper',
        version: '0.0.1',
        exec: ['node', 'dist/server.js'],
        cwd: uri('/project/node_modules/@causeeffect/jsx-content-mapper'),
        compilerOptions: ['jsxFactory', 'jsxFragmentFactory'],
        dynamicConfig: false,
      },
      runtimeModule:
        '/project/node_modules/@causeeffect/jsx-content-mapper/dist/runtime.js',
      source: 'workspace' as const,
    },
    resolveContentMapper: vi.fn(),
  };
});

vi.mock('vscode', () => ({
  Uri: {
    file: host.uri,
    joinPath: (base: { fsPath: string }, ...segments: string[]) =>
      host.uri([base.fsPath.replace(/\/$/, ''), ...segments].join('/')),
  },
  Disposable: class {
    constructor(private callback: () => unknown) {}
    dispose() {
      this.callback();
    }
    static from(...disposables: { dispose(): unknown }[]) {
      return new this(() => disposables.forEach((value) => value.dispose()));
    }
  },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  extensions: {
    getExtension: host.getExtension,
    onDidChange: host.extensionsChanged.register,
  },
  commands: {
    registerCommand: host.registerCommand,
    executeCommand: host.executeCommand,
    getCommands: host.getCommands,
  },
  window: {
    createOutputChannel: vi.fn(() => host.output),
    showWarningMessage: host.showWarningMessage,
    showInformationMessage: host.showInformationMessage,
    showErrorMessage: host.showErrorMessage,
  },
  workspace: {
    get isTrusted() {
      return host.isTrusted;
    },
    get workspaceFolders() {
      return host.folders;
    },
    onDidChangeConfiguration: host.configurationChanged.register,
    onDidChangeWorkspaceFolders: host.foldersChanged.register,
    onDidGrantWorkspaceTrust: host.trustGranted.register,
    getConfiguration: (section: string) => ({
      get: (key: string, fallback?: unknown) =>
        host.settings.get(`${section}.${key}`) ??
        host.globalSettings.get(`${section}.${key}`) ??
        fallback,
      inspect: (key: string) => ({
        workspaceValue: host.folders.length
          ? host.settings.get(`${section}.${key}`)
          : undefined,
        globalValue: host.folders.length
          ? host.globalSettings.get(`${section}.${key}`)
          : host.settings.get(`${section}.${key}`),
      }),
      has: (key: string) => host.settings.has(`${section}.${key}`),
      update: (key: string, value: unknown, target?: unknown) =>
        host.update(section, key, value, target),
    }),
  },
}));

vi.mock('./mapper.js', () => ({
  resolveContentMapper: host.resolveContentMapper,
}));

let extension: typeof import('./extension.js') | undefined;
let context: VSCode.ExtensionContext;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  host.commands.clear();
  host.settings.clear();
  host.globalSettings.clear();
  host.settings.set('js/ts.experimental.useTsgo', true);
  host.settings.set('js/ts.contentMappers.enabled', true);
  host.registrationDisposals.length = 0;
  host.isTrusted = true;
  host.folders = [{ name: 'project', index: 0, uri: host.uri('/project') }];
  host.nativeExtension.exports = host.nativeApi;
  host.getCommands.mockResolvedValue(['typescript.native-preview.restart']);
  host.executeCommand.mockReset().mockResolvedValue(undefined);
  host.onLanguageServerInitialized.mockImplementation((listener) => {
    listener();
    return host.nativeInitialized.register(listener);
  });
  host.getExtension.mockImplementation((id) =>
    id === 'TypeScriptTeam.native-preview'
      ? host.nativeExtension
      : id === 'TypeScriptTeam.vscode-typescript-nightly'
        ? host.nightlyExtension
        : undefined,
  );
  host.resolveContentMapper.mockReturnValue(host.resolved);
  for (const event of [
    host.configurationChanged,
    host.foldersChanged,
    host.trustGranted,
    host.extensionsChanged,
    host.nativeInitialized,
  ])
    event.listeners.clear();
  context = {
    extensionUri: host.uri('/extension'),
    subscriptions: [],
    extension: { id: 'causeeffect.gtsx' },
  } as unknown as VSCode.ExtensionContext;
  extension = undefined;
});

afterEach(async () => {
  for (const subscription of context.subscriptions) subscription.dispose();
  await extension?.deactivate();
});

async function activate() {
  extension = await import('./extension.js');
  await extension.activate(context);
}

function contributions() {
  const call = host.registerContentMappers.mock.calls.at(-1);
  return call?.find((argument) => Array.isArray(argument)) as
    Record<string, unknown>[] | undefined;
}

function configEvent(...sections: string[]) {
  return {
    affectsConfiguration: (section: string) =>
      sections.some(
        (changed) =>
          changed === section ||
          changed.startsWith(`${section}.`) ||
          section.startsWith(`${changed}.`),
      ),
  };
}

describe('GTSX extension activation', () => {
  it('registers the content mapper and runtime for inferred .gtsx projects', async () => {
    await activate();
    expect(host.getExtension).toHaveBeenCalledWith(
      'TypeScriptTeam.native-preview',
    );
    expect(host.resolveContentMapper).toHaveBeenCalledWith(
      host.folders,
      context.extensionUri,
      host.output,
    );
    expect(host.registerContentMappers).toHaveBeenCalledTimes(1);
    expect(contributions()).toEqual([
      expect.objectContaining({
        extensions: ['.gtsx'],
        inferredProjectContribution: expect.objectContaining({
          manifest: host.resolved.manifest,
          options: expect.objectContaining({
            runtimeModule: host.resolved.runtimeModule,
          }),
        }),
      }),
    ]);
  });

  it('does not change the native TypeScript setting while activating', async () => {
    host.settings.set('js/ts.experimental.useTsgo', false);
    await activate();
    expect(host.update).not.toHaveBeenCalled();
    expect(host.settings.get('js/ts.experimental.useTsgo')).toBe(false);
  });

  it('defers workspace package resolution and mapper registration until workspace trust is granted', async () => {
    host.isTrusted = false;
    await activate();
    expect(host.resolveContentMapper).not.toHaveBeenCalled();
    expect(host.nativeExtension.activate).not.toHaveBeenCalled();
    expect(host.getExtension).not.toHaveBeenCalled();
    expect(host.registerContentMappers).not.toHaveBeenCalled();
    host.isTrusted = true;
    await host.trustGranted.emit();
    await vi.waitFor(() =>
      expect(host.registerContentMappers).toHaveBeenCalledTimes(1),
    );
  });

  it('disposes the old registration before registering for new workspace folders', async () => {
    await activate();
    const firstDisposal = host.registrationDisposals[0];
    host.folders = [{ name: 'second', index: 0, uri: host.uri('/second') }];
    await host.foldersChanged.emit({ added: host.folders, removed: [] });
    await vi.waitFor(() =>
      expect(host.registerContentMappers).toHaveBeenCalledTimes(2),
    );
    expect(firstDisposal).toHaveBeenCalledTimes(1);
    expect(host.resolveContentMapper).toHaveBeenLastCalledWith(
      host.folders,
      context.extensionUri,
      host.output,
    );
  });

  it('refreshes the mapper when its configuration changes', async () => {
    await activate();
    const firstDisposal = host.registrationDisposals[0];
    await host.configurationChanged.emit(
      configEvent('gtsx.inferredProjectOptions'),
    );
    await vi.waitFor(() =>
      expect(host.registerContentMappers).toHaveBeenCalledTimes(2),
    );
    expect(firstDisposal).toHaveBeenCalledTimes(1);
  });

  it('ignores configuration changes outside GTSX and TypeScript', async () => {
    await activate();
    await host.configurationChanged.emit(configEvent('editor.fontSize'));
    expect(host.registerContentMappers).toHaveBeenCalledTimes(1);
  });

  it('disposes its registration and event listeners with the extension context', async () => {
    await activate();
    for (const subscription of context.subscriptions) subscription.dispose();
    expect(host.registrationDisposals[0]).toHaveBeenCalledTimes(1);
    expect(host.foldersChanged.listeners.size).toBe(0);
    expect(host.configurationChanged.listeners.size).toBe(0);
    expect(host.trustGranted.listeners.size).toBe(0);
    // VS Code disposes subscriptions only once.
    context.subscriptions.length = 0;
  });

  it('reports an unsupported native extension API without registering a mapper', async () => {
    host.nativeExtension.exports = {};
    await activate();
    expect(host.registerContentMappers).not.toHaveBeenCalled();
    expect(host.showWarningMessage).toHaveBeenCalled();
  });

  it('enables native TypeScript only in response to the explicit command', async () => {
    host.settings.set('js/ts.experimental.useTsgo', false);
    host.settings.set('js/ts.contentMappers.enabled', false);
    await activate();
    expect(host.update).not.toHaveBeenCalled();
    const enable = host.commands.get('gtsx.enableLanguageSupport');
    expect(enable).toBeDefined();
    await enable?.();
    expect(host.update).toHaveBeenCalledWith(
      'js/ts',
      'experimental.useTsgo',
      true,
      2,
    );
    expect(host.update.mock.calls.map((call) => call[1])).toEqual([
      'contentMappers.enabled',
      'experimental.useTsgo',
    ]);
    expect(
      host.registerContentMappers.mock.invocationCallOrder.at(-1),
    ).toBeLessThan(host.update.mock.invocationCallOrder[0] ?? 0);
    expect(host.executeCommand).not.toHaveBeenCalled();
    expect(host.update).toHaveBeenCalledWith(
      'js/ts',
      'contentMappers.enabled',
      true,
      2,
    );
  });

  it('honors custom mapper options for inferred projects', async () => {
    host.settings.set('gtsx.inferredProjectOptions', {
      jsxRuntime: 'classic',
      jsxFactory: 'jsx.makeElement',
      jsxFragmentFactory: 'jsx.Fragment',
    });
    await activate();
    expect(contributions()?.[0]).toMatchObject({
      inferredProjectContribution: {
        options: {
          jsxRuntime: 'classic',
          jsxFactory: 'jsx.makeElement',
          jsxFragmentFactory: 'jsx.Fragment',
        },
      },
    });
  });

  it('does not register after disposal while package resolution is still pending', async () => {
    let resolveMapper: ((value: typeof host.resolved) => void) | undefined;
    host.resolveContentMapper.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveMapper = resolve;
      }),
    );
    const activating = activate();
    await vi.waitFor(() =>
      expect(host.resolveContentMapper).toHaveBeenCalled(),
    );
    for (const subscription of context.subscriptions) subscription.dispose();
    context.subscriptions.length = 0;
    resolveMapper?.(host.resolved);
    await activating;
    expect(host.registerContentMappers).not.toHaveBeenCalled();
  });

  it('enables language support globally only when no workspace is open', async () => {
    host.folders = [];
    host.settings.set('js/ts.experimental.useTsgo', false);
    host.settings.set('js/ts.contentMappers.enabled', false);
    await activate();
    await host.commands.get('gtsx.enableLanguageSupport')?.();
    expect(host.update).toHaveBeenCalledWith(
      'js/ts',
      'experimental.useTsgo',
      true,
      1,
    );
    expect(host.update).toHaveBeenCalledWith(
      'js/ts',
      'contentMappers.enabled',
      true,
      1,
    );
  });

  it('keeps settings unchanged when the enable command runs in an untrusted workspace', async () => {
    host.isTrusted = false;
    await activate();
    await host.commands.get('gtsx.enableLanguageSupport')?.();
    expect(host.update).not.toHaveBeenCalled();
    expect(host.nativeExtension.activate).not.toHaveBeenCalled();
    expect(host.showWarningMessage).toHaveBeenCalled();
  });

  it('restarts Native Preview after Enable even when the native settings are already true', async () => {
    await activate();
    expect(host.executeCommand).not.toHaveBeenCalled();
    await host.commands.get('gtsx.enableLanguageSupport')?.();
    expect(host.executeCommand).toHaveBeenCalledWith(
      'typescript.native-preview.restart',
    );
    expect(host.update).not.toHaveBeenCalled();
    expect(host.nativeInitialized.listeners.size).toBe(0);
  });

  it.each(['experimental.useTsgo', 'contentMappers.enabled'])(
    'leaves the setting-driven restart to Native Preview when %s is disabled',
    async (setting) => {
      host.settings.set(`js/ts.${setting}`, false);
      host.executeCommand.mockRejectedValueOnce(
        new Error('Language client is not initialized'),
      );
      await activate();
      await expect(
        host.commands.get('gtsx.enableLanguageSupport')?.(),
      ).resolves.toBeUndefined();
      expect(host.update).toHaveBeenCalledTimes(1);
      expect(host.update).toHaveBeenCalledWith('js/ts', setting, true, 2);
      expect(host.getCommands).not.toHaveBeenCalled();
      expect(host.executeCommand).not.toHaveBeenCalled();
    },
  );

  it('waits for a starting client before restarting with already enabled settings', async () => {
    host.onLanguageServerInitialized.mockImplementation((listener) =>
      host.nativeInitialized.register(listener),
    );
    await activate();
    const enabling = host.commands.get('gtsx.enableLanguageSupport')?.();
    await vi.waitFor(() =>
      expect(host.nativeInitialized.listeners.size).toBe(1),
    );
    expect(host.executeCommand).not.toHaveBeenCalled();
    await host.nativeInitialized.emit();
    await enabling;
    expect(host.executeCommand).toHaveBeenCalledWith(
      'typescript.native-preview.restart',
    );
    expect(host.nativeInitialized.listeners.size).toBe(0);
  });

  it('propagates an initialized provider restart failure', async () => {
    await activate();
    host.executeCommand.mockRejectedValueOnce(new Error('Compiler crashed'));
    await expect(
      host.commands.get('gtsx.enableLanguageSupport')?.(),
    ).rejects.toThrow('Compiler crashed');
  });

  it('cancels a pending initialization wait when the extension is disposed', async () => {
    host.onLanguageServerInitialized.mockImplementation((listener) =>
      host.nativeInitialized.register(listener),
    );
    await activate();
    const enabling = host.commands.get('gtsx.enableLanguageSupport')?.();
    await vi.waitFor(() =>
      expect(host.nativeInitialized.listeners.size).toBe(1),
    );
    await extension?.deactivate();
    await enabling;
    expect(host.nativeInitialized.listeners.size).toBe(0);
    expect(host.getCommands).not.toHaveBeenCalled();
    expect(host.executeCommand).not.toHaveBeenCalled();
  });

  it('reports initialization timeout without restarting and removes the listener', async () => {
    host.onLanguageServerInitialized.mockImplementation((listener) =>
      host.nativeInitialized.register(listener),
    );
    await activate();
    vi.useFakeTimers();
    try {
      const enabling = host.commands.get('gtsx.enableLanguageSupport')?.();
      const assertion = expect(enabling).rejects.toThrow(
        'did not initialize within 30 seconds',
      );
      await vi.advanceTimersByTimeAsync(30_000);
      await assertion;
      expect(host.nativeInitialized.listeners.size).toBe(0);
      expect(host.executeCommand).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not enable settings after disposal during mapper refresh', async () => {
    host.settings.set('js/ts.experimental.useTsgo', false);
    host.settings.set('js/ts.contentMappers.enabled', false);
    await activate();
    let resolveMapper: ((value: typeof host.resolved) => void) | undefined;
    host.resolveContentMapper.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveMapper = resolve;
      }),
    );
    const enabling = host.commands.get('gtsx.enableLanguageSupport')?.();
    await vi.waitFor(() => expect(resolveMapper).toBeDefined());
    await extension?.deactivate();
    resolveMapper?.(host.resolved);
    await enabling;
    expect(host.update).not.toHaveBeenCalled();
    expect(host.executeCommand).not.toHaveBeenCalled();
  });

  it('sets the workspace flag when an inherited true value can be overridden by legacy settings', async () => {
    host.settings.delete('js/ts.experimental.useTsgo');
    host.globalSettings.set('js/ts.experimental.useTsgo', true);
    host.settings.set('typescript.experimental.useTsgo', false);
    await activate();
    await host.commands.get('gtsx.enableLanguageSupport')?.();
    expect(host.update).toHaveBeenCalledWith(
      'js/ts',
      'experimental.useTsgo',
      true,
      2,
    );
    expect(host.update).toHaveBeenCalledTimes(1);
    expect(host.settings.get('js/ts.experimental.useTsgo')).toBe(true);
    expect(host.executeCommand).not.toHaveBeenCalled();
  });

  it('does not call an unavailable restart command when Native Preview has not started', async () => {
    host.getCommands.mockResolvedValueOnce([]);
    await activate();
    await expect(
      host.commands.get('gtsx.enableLanguageSupport')?.(),
    ).resolves.toBeUndefined();
    expect(host.executeCommand).not.toHaveBeenCalled();
    expect(host.settings.get('js/ts.experimental.useTsgo')).toBe(true);
  });

  it('warns once when an older bundled compiler has no Nightly contribution or SDK override', async () => {
    host.getExtension.mockImplementation((id) =>
      id === 'TypeScriptTeam.native-preview' ? host.nativeExtension : undefined,
    );
    await activate();
    await host.commands.get('gtsx.restartLanguageSupport')?.();
    expect(host.showWarningMessage).toHaveBeenCalledTimes(1);
    expect(host.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('TypeScript 7.1 or later'),
    );
    expect(host.output.appendLine).toHaveBeenCalledWith(
      expect.stringContaining('TypeScript 7.0.2'),
    );
    expect(host.update).not.toHaveBeenCalled();
  });

  it('honors an existing SDK override when the Nightly contribution is absent', async () => {
    host.getExtension.mockImplementation((id) =>
      id === 'TypeScriptTeam.native-preview' ? host.nativeExtension : undefined,
    );
    host.settings.set('js/ts.tsdk.path', '/custom/typescript/lib');
    await activate();
    expect(host.showWarningMessage).not.toHaveBeenCalled();
    expect(host.output.appendLine).toHaveBeenCalledWith(
      'Configured TypeScript SDK: /custom/typescript/lib',
    );
    expect(host.update).not.toHaveBeenCalled();
  });

  it('reports mapper failures and allows the refresh command to recover', async () => {
    host.resolveContentMapper.mockRejectedValueOnce(
      new Error('Missing bundled mapper'),
    );
    await activate();
    expect(host.registerContentMappers).not.toHaveBeenCalled();
    expect(host.showErrorMessage).toHaveBeenCalled();
    expect(host.output.appendLine).toHaveBeenCalledWith(
      expect.stringContaining('Missing bundled mapper'),
    );
    await host.commands.get('gtsx.restartLanguageSupport')?.();
    expect(host.registerContentMappers).toHaveBeenCalledTimes(1);
  });
});
