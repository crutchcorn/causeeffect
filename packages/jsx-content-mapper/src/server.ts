import { runContentMapper } from 'ts-content-mapper';
import {
  transformGtsx,
  validateGtsxOptions,
  type GtsxOptions,
} from './lib/content-mapper.js';

runContentMapper<GtsxOptions>({
  diagnosticSource: 'gtsx',
  openProject(params) {
    return { optionDiagnostics: validateGtsxOptions(params.options ?? {}) };
  },
  transform(params, context) {
    // The compiler may still ask for files after openProject reports bad options.
    // Keep that request successful so the option diagnostics reach tsconfig.json.
    if (validateGtsxOptions(context.openProjectParams.options ?? {}).length) {
      return { text: 'export {};', extension: '.ts' };
    }
    return transformGtsx(params.content, {
      ...context.openProjectParams.options,
      fileName: params.fileName,
      positionEncoding: context.positionEncoding,
      ...(context.openProjectParams.options?.jsxRuntime === 'classic'
        ? {
            jsxFactory:
              context.openProjectParams.options.jsxFactory ??
              (context.openProjectParams.compilerOptions.jsxFactory as
                string | undefined),
            jsxFragmentFactory:
              context.openProjectParams.options.jsxFragmentFactory ??
              (context.openProjectParams.compilerOptions.jsxFragmentFactory as
                string | undefined),
          }
        : {}),
    });
  },
});
