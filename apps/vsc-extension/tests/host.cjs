const { writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const vscode = require('vscode');

async function eventually(description, probe) {
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    let probeTimeout;
    try {
      const result = await Promise.race([
        probe(),
        new Promise((_, reject) => {
          probeTimeout = setTimeout(
            () => reject(new Error('Provider request timed out')),
            Math.min(2_000, deadline - Date.now()),
          );
        }),
      ]);
      if (result) return result;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(probeTimeout);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `${description} did not become available within 30 seconds.${lastError ? ` Last error: ${lastError}` : ''}`,
  );
}

function positionOf(document, value, occurrence = 0) {
  const text = document.getText();
  let offset = -1;
  for (let index = 0; index <= occurrence; index++)
    offset = text.indexOf(value, offset + 1);
  if (offset < 0) throw new Error(`Missing fixture text ${value}`);
  return document.positionAt(offset);
}

exports.run = async function run() {
  const workspace = process.env.GTSX_HOST_WORKSPACE;
  const resultPath = process.env.GTSX_HOST_TEST_RESULT;
  if (!workspace || !resultPath)
    throw new Error('Launch this probe through the Vitest test:host command.');
  const result = { passed: false, vscodeVersion: vscode.version };
  try {
    result.workspaceTrusted = vscode.workspace.isTrusted;
    const extension = vscode.extensions.getExtension(
      'causeeffect.causeeffect-gtsx',
    );
    if (!extension)
      throw new Error('VS Code must discover the development extension.');
    await extension.activate();
    result.extensionActive = extension.isActive;
    const native = vscode.extensions.getExtension(
      'TypeScriptTeam.native-preview',
    );
    if (!native)
      throw new Error(
        'The isolated profile must load the native TypeScript provider.',
      );
    const api = await native.activate();
    result.nativeApi = typeof api.registerContentMappers;
    result.nativeExtensionVersion = native.packageJSON.version;
    result.bundledCompilerVersion = native.packageJSON.bundledTypeScriptVersion;
    result.sdkPath = vscode.workspace
      .getConfiguration('js/ts')
      .get('tsdk.path');
    const nightly = vscode.extensions.getExtension(
      'TypeScriptTeam.vscode-typescript-nightly',
    );
    if (!nightly)
      throw new Error(
        'The isolated profile must load the official TypeScript Nightly compiler contribution.',
      );
    result.nightlyExtensionVersion = nightly.packageJSON.version;

    const uri = vscode.Uri.file(join(workspace, 'main.gtsx'));
    const document = await vscode.workspace.openTextDocument(uri);
    result.languageId = document.languageId;
    await vscode.window.showTextDocument(document);
    if (process.env.GTSX_HOST_ENABLE_COMMAND === '1') {
      const configuration = vscode.workspace.getConfiguration('js/ts');
      result.nativeEnabledBeforeCommand = configuration.get(
        'experimental.useTsgo',
      );
      await vscode.commands.executeCommand('gtsx.enableLanguageSupport');
      const enabledConfiguration = vscode.workspace.getConfiguration('js/ts');
      result.nativeEnabledAfterCommand = enabledConfiguration.get(
        'experimental.useTsgo',
      );
      result.contentMappersEnabledAfterCommand = enabledConfiguration.get(
        'contentMappers.enabled',
      );
      result.sdkPathAfterCommand = enabledConfiguration.get('tsdk.path');
      result.enabledByCommand = true;
    }
    const expectedType =
      'JSX.GeneratorElement<number, JSX.GeneratorElement<never, never, never>, unknown>';
    let latestHover = '';
    const probeHover = async () => {
      const hovers = await vscode.commands.executeCommand(
        'vscode.executeHoverProvider',
        uri,
        positionOf(document, 'Result'),
      );
      latestHover = (hovers ?? [])
        .flatMap((hover) =>
          hover.contents.map((content) =>
            typeof content === 'string' ? content : content.value,
          ),
        )
        .join('\n');
      return latestHover.includes(expectedType) ? latestHover : undefined;
    };
    const readHover = (description) =>
      eventually(description, probeHover).catch((error) => {
        throw new Error(`${error.message} Last hover: ${latestHover}`);
      });
    result.hover = await readHover('Generator-preserving hover');
    if (process.env.GTSX_HOST_ENABLE_COMMAND === '1') {
      // Also exercise the explicit restart with both settings already enabled.
      await vscode.commands.executeCommand('gtsx.enableLanguageSupport');
      result.reenabledByCommand = true;
      result.hover = await readHover(
        'Generator-preserving hover after repeating Enable',
      );
    }

    const definition = await eventually(
      'Cross-file component definition',
      async () => {
        const locations = await vscode.commands.executeCommand(
          'vscode.executeDefinitionProvider',
          uri,
          positionOf(document, 'Counter', 1),
        );
        return locations?.find(
          (location) =>
            (location.targetUri ?? location.uri).fsPath ===
            join(workspace, 'counter.gtsx'),
        );
      },
    );
    const definitionRange = definition.targetSelectionRange ?? definition.range;
    result.definition = {
      file: 'counter.gtsx',
      line: definitionRange.start.line,
    };

    const diagnostic = await eventually(
      'Mapped invalid-prop diagnostic',
      async () =>
        vscode.languages
          .getDiagnostics(uri)
          .find(
            (item) =>
              item.severity === vscode.DiagnosticSeverity.Error &&
              Number(
                typeof item.code === 'object' ? item.code.value : item.code,
              ) === 2322,
          ),
    );
    result.diagnostic = {
      code: 2322,
      message: diagnostic.message,
      text: document.getText(diagnostic.range),
    };
    result.passed = true;
    console.log('GTSX real extension-host smoke test passed.');
  } catch (error) {
    result.error = String(error);
    throw error;
  } finally {
    await writeFile(resultPath, JSON.stringify(result, null, 2));
  }
};
