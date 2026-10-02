import { runContentMapper } from 'ts-content-mapper';
import { transformGtsx, type GtsxOptions } from './lib/content-mapper.js';

runContentMapper<GtsxOptions>({
  diagnosticSource: 'gtsx',
  openProject(params) {
    const runtimeModule = params.options?.runtimeModule;
    if (
      runtimeModule !== undefined &&
      (typeof runtimeModule !== 'string' || !runtimeModule.trim())
    ) {
      return {
        optionDiagnostics: [
          {
            path: ['runtimeModule'],
            messageText: 'runtimeModule must be a nonempty module specifier.',
            code: 3,
          },
        ],
      };
    }
    return {};
  },
  transform(params, context) {
    return transformGtsx(params.content, {
      fileName: params.fileName,
      positionEncoding: context.positionEncoding,
      runtimeModule: context.openProjectParams.options?.runtimeModule,
    });
  },
});
