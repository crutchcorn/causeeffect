const assert = require('node:assert/strict');
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
  assert.ok(offset >= 0, `Missing fixture text ${value}`);
  return document.positionAt(offset);
}

exports.run = async function run() {
  const workspace = process.env.GTSX_HOST_WORKSPACE;
  const resultPath = process.env.GTSX_HOST_TEST_RESULT;
  assert.ok(
    workspace && resultPath,
    'Launch this runner through scripts/test-host.mjs.',
  );
  const result = { passed: false, vscodeVersion: vscode.version };
  try {
    assert.equal(
      vscode.workspace.isTrusted,
      true,
      'The isolated test workspace must be trusted.',
    );
    const extension = vscode.extensions.getExtension(
      'causeeffect.causeeffect-gtsx',
    );
    assert.ok(extension, 'VS Code must discover the development extension.');
    await extension.activate();
    assert.equal(extension.isActive, true);
    const native = vscode.extensions.getExtension(
      'TypeScriptTeam.native-preview',
    );
    assert.ok(
      native,
      'The isolated profile must load the native TypeScript provider.',
    );
    const api = await native.activate();
    assert.equal(typeof api.registerContentMappers, 'function');
    result.nativeExtensionVersion = native.packageJSON.version;
    result.bundledCompilerVersion = native.packageJSON.bundledTypeScriptVersion;
    result.sdkPath = vscode.workspace
      .getConfiguration('js/ts')
      .get('tsdk.path');
    const nightly = vscode.extensions.getExtension(
      'TypeScriptTeam.vscode-typescript-nightly',
    );
    assert.ok(
      nightly,
      'The isolated profile must load the official TypeScript Nightly compiler contribution.',
    );
    result.nightlyExtensionVersion = nightly.packageJSON.version;
    if (process.env.GTSX_HOST_COMPILER_MODE === 'provider') {
      assert.ok(
        !result.sdkPath,
        'The default host test must not override the SDK path.',
      );
    }

    const uri = vscode.Uri.file(join(workspace, 'main.gtsx'));
    const document = await vscode.workspace.openTextDocument(uri);
    assert.equal(document.languageId, 'gtsx');
    await vscode.window.showTextDocument(document);
    if (process.env.GTSX_HOST_ENABLE_COMMAND === '1') {
      const configuration = vscode.workspace.getConfiguration('js/ts');
      result.nativeEnabledBeforeCommand = configuration.get(
        'experimental.useTsgo',
      );
      await vscode.commands.executeCommand('gtsx.enableLanguageSupport');
      assert.equal(configuration.get('experimental.useTsgo'), true);
      assert.equal(configuration.get('contentMappers.enabled'), true);
      if (process.env.GTSX_HOST_COMPILER_MODE === 'provider') {
        assert.ok(
          !configuration.get('tsdk.path'),
          'The Enable command must use the contributed Nightly without setting an SDK override.',
        );
      }
      result.enabledByCommand = true;
    }
    const expectedType =
      'JSX.GeneratorElement<number, JSX.GeneratorElement<never, never, never>, unknown>';
    let latestHover = '';
    result.hover = await eventually('Generator-preserving hover', async () => {
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
    }).catch((error) => {
      throw new Error(`${error.message} Last hover: ${latestHover}`);
    });

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
    assert.equal(definitionRange.start.line, 0);
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
    assert.match(
      diagnostic.message,
      /Type 'string' is not assignable to type 'number'/,
    );
    assert.equal(document.getText(diagnostic.range), 'count');
    result.diagnostic = { code: 2322, message: diagnostic.message };
    result.passed = true;
    console.log('GTSX real extension-host smoke test passed.');
  } catch (error) {
    result.error = String(error);
    throw error;
  } finally {
    await writeFile(resultPath, JSON.stringify(result, null, 2));
  }
};
