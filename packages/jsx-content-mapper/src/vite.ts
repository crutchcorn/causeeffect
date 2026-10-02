import {
  GenMapping,
  addSegment,
  setSourceContent,
  toEncodedMap,
} from '@jridgewell/gen-mapping';
import { SpanMapKind, type TransformResult } from 'ts-content-mapper';
import { transformWithOxc, type Plugin, type Rolldown } from 'vite';
import {
  transformGtsx,
  validateGtsxOptions,
  type GtsxOptions,
} from './lib/content-mapper.js';

function lineStarts(text: string): number[] {
  const starts = [0];
  for (const match of text.matchAll(/\r\n|[\n\r\u2028\u2029]/g)) {
    starts.push(match.index + match[0].length);
  }
  return starts;
}

function location(starts: number[], offset: number) {
  let low = 0;
  let high = starts.length;
  while (low + 1 < high) {
    const middle = (low + high) >>> 1;
    if (starts[middle] <= offset) low = middle;
    else high = middle;
  }
  return { line: low, column: offset - starts[low] };
}

/** Convert UTF-16 mapper spans to a source map before TypeScript is erased. */
function sourceMap(source: string, id: string, result: TransformResult) {
  const map = new GenMapping({ file: id });
  setSourceContent(map, id, source);
  const originalLines = lineStarts(source);
  const generatedLines = lineStarts(result.text);

  for (const [
    generatedStart,
    length,
    originalStart,
    ,
    kind,
  ] of result.mappings ?? []) {
    // Verbatim spans need exact columns for Oxc's token-level map composition.
    // Atoms and aliases refer to their original span as a single unit.
    for (let relative = 0; relative < length; relative++) {
      const generatedOffset = generatedStart + relative;
      const generated = location(generatedLines, generatedOffset);
      if (kind !== SpanMapKind.Verbatim && relative && generated.column) {
        continue;
      }
      const original = location(
        originalLines,
        originalStart + (kind === SpanMapKind.Verbatim ? relative : 0),
      );
      addSegment(
        map,
        generated.line,
        generated.column,
        id,
        original.line,
        original.column,
      );
    }

    // Synthesized runtime calls must not inherit the preceding source location.
    const end = location(generatedLines, generatedStart + length);
    addSegment(map, end.line, end.column);
  }
  return toEncodedMap(map);
}

/** Compile .gtsx with the same JSX runtime options used by the content mapper. */
export function gtsx(options: GtsxOptions = {}): Plugin {
  const diagnostics = validateGtsxOptions(options);
  if (diagnostics.length) {
    throw new TypeError(
      diagnostics.map(({ messageText }) => messageText).join('\n'),
    );
  }
  const transform = async function (
    this: Rolldown.TransformPluginContext,
    source: string,
    id: string,
  ) {
    const [fileName, query = ''] = id.split('?', 2);
    if (!fileName.endsWith('.gtsx')) return;
    const parameters = new URLSearchParams(query);
    if (parameters.has('raw') || parameters.has('url')) return;

    const result = transformGtsx(source, {
      ...options,
      fileName,
      positionEncoding: 'utf-16',
    });
    const diagnostic = result.diagnostics?.[0];
    if (diagnostic) {
      this.error({
        id: fileName,
        pos: diagnostic.start,
        message: diagnostic.messageText,
      });
    }

    const compiled = await transformWithOxc(
      result.text,
      fileName,
      { lang: 'ts', sourcemap: true },
      sourceMap(source, fileName, result),
    );
    for (const warning of compiled.warnings) this.warn(warning);
    return {
      code: compiled.code,
      map: compiled.map,
      moduleType: 'js' as const,
    };
  };

  return {
    name: '@causeeffect/gtsx',
    enforce: 'pre',
    config(config) {
      const extensions = config.resolve?.extensions ?? [
        '.mjs',
        '.js',
        '.mts',
        '.ts',
        '.jsx',
        '.tsx',
        '.json',
      ];
      return {
        resolve: {
          extensions: extensions.includes('.gtsx')
            ? extensions
            : [...extensions, '.gtsx'],
        },
        optimizeDeps: {
          extensions: ['.gtsx'],
          rolldownOptions: {
            plugins: [{ name: '@causeeffect/gtsx:dependencies', transform }],
          },
        },
      };
    },
    transform,
  };
}

export default gtsx;
