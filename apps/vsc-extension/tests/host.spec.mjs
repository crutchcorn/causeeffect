import { expect, test } from 'vitest';
import { runHostSmokeTest } from '../scripts/test-host.mjs';

test('supports generator JSX in a real VS Code extension host', async () => {
  await runHostSmokeTest((result) => {
    expect(result.passed, result.error).toBe(true);
    expect(result.workspaceTrusted).toBe(true);
    expect(result.extensionActive).toBe(true);
    expect(result.nativeApi).toBe('function');
    expect(result.nativeExtensionVersion).toEqual(expect.any(String));
    expect(result.nightlyExtensionVersion).toEqual(expect.any(String));
    expect(result.languageId).toBe('gtsx');
    expect(result.hover).toContain(
      'JSX.GeneratorElement<number, JSX.GeneratorElement<never, never, never>, unknown>',
    );
    expect(result.definition).toEqual({ file: 'counter.gtsx', line: 0 });
    expect(result.diagnostic).toEqual({
      code: 2322,
      message: expect.stringMatching(
        /Type 'string' is not assignable to type 'number'/,
      ),
      text: 'count',
    });

    if (process.env.HOST_TEST_COMPILER !== 'nightly') {
      expect(result.sdkPath).toBeFalsy();
    }
    if (process.env.HOST_TEST_ENABLE_COMMAND !== '0') {
      expect(result.nativeEnabledBeforeCommand).toBe(false);
      expect(result.enabledByCommand).toBe(true);
      expect(result.nativeEnabledAfterCommand).toBe(true);
      expect(result.contentMappersEnabledAfterCommand).toBe(true);
      if (process.env.HOST_TEST_COMPILER !== 'nightly') {
        expect(result.sdkPathAfterCommand).toBeFalsy();
      }
    }
  });
});
