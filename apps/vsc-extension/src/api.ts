import type { Disposable, Event, Uri } from 'vscode';

/** Public API exported by TypeScriptTeam.native-preview. */
export interface ContentMapperManifest {
  readonly name: string;
  readonly version?: string;
  readonly exec: readonly string[];
  readonly cwd?: Uri;
  readonly compilerOptions?: readonly string[];
  readonly dynamicConfig?: boolean;
}

export interface ContentMapperContribution {
  readonly extensions: readonly string[];
  readonly inferredProjectContribution?: {
    readonly options?: Readonly<Record<string, unknown>>;
    readonly manifest: ContentMapperManifest;
  };
}

export interface TypeScriptNativeApi {
  readonly onLanguageServerInitialized: Event<void>;
  registerContentMappers(
    contributorId: string,
    contributions: readonly ContentMapperContribution[],
  ): Disposable;
}

export function isTypeScriptNativeApi(
  value: unknown,
): value is TypeScriptNativeApi {
  return (
    typeof value === 'object' &&
    value !== null &&
    'onLanguageServerInitialized' in value &&
    typeof value.onLanguageServerInitialized === 'function' &&
    'registerContentMappers' in value &&
    typeof value.registerContentMappers === 'function'
  );
}
