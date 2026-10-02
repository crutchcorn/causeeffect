/** The marker used by mapped JSX fragments. */
export const Fragment = Symbol('@causeeffect/jsx-content-mapper.fragment');

declare const generatorSignature: unique symbol;

/** Properties on intrinsic elements are supplied by the eventual UI framework. */
export type IntrinsicProps = Readonly<Record<string, unknown>>;

export interface IntrinsicDescription {
  readonly kind: 'intrinsic';
  readonly type: string;
  readonly props: IntrinsicProps;
}

export interface FragmentDescription {
  readonly kind: 'fragment';
  readonly type: typeof Fragment;
  readonly props: IntrinsicProps;
}

export interface ComponentDescription<Yield, Return, Next> {
  readonly kind: 'component';
  /** A generator remains suspended until a framework advances this iterator. */
  readonly value:
    | Generator<Yield, Return, Next>
    | AsyncGenerator<Yield, Return, Next>
    | Return;
}

/** Type names available to a `.gtsx` module through a type-only import. */
// eslint-disable-next-line @typescript-eslint/no-namespace -- JSX.GeneratorElement is a type-only namespace API.
export declare namespace JSX {
  /**
   * A lazy element description that retains all three generator parameters.
   *
   * The signature is a type-only marker. Calling a generator component creates
   * its iterator without starting its body. Intrinsic elements and fragments
   * have three `never`s.
   */
  export type GeneratorElement<Yield, Return, Next> = {
    readonly [generatorSignature]?: Generator<Yield, Return, Next>;
  } & (
    | IntrinsicDescription
    | FragmentDescription
    | ComponentDescription<Yield, Return, Next>
  );

  export type Element = GeneratorElement<unknown, unknown, never>;

  export interface IntrinsicElements {
    [name: string]: IntrinsicProps;
  }
}

/**
 * Describe an intrinsic element or a fragment. Children, when present, live in
 * `props.children`; mapping JSX follows the usual single-child/array convention.
 */
export function createElement(
  type: string | typeof Fragment,
  props: IntrinsicProps | null = null,
): JSX.GeneratorElement<never, never, never> {
  const snapshot = Object.freeze({ ...props });

  if (type === Fragment) {
    return Object.freeze({ kind: 'fragment', type, props: snapshot });
  }

  return Object.freeze({ kind: 'intrinsic', type, props: snapshot });
}

/**
 * Supply the usual empty JSX props object without requiring no-argument
 * components to declare a props parameter. The tuple type lets the direct
 * component call still diagnose missing required properties.
 */
export function emptyProps<
  Component extends (...args: never[]) => unknown,
>(): Component extends () => unknown ? [] : [Record<never, never>] {
  return [{}] as Component extends () => unknown ? [] : [Record<never, never>];
}

type IteratorElement<Value> =
  Value extends Generator<infer Yield, infer Return, infer Next>
    ? JSX.GeneratorElement<Yield, Return, Next>
    : Value extends AsyncGenerator<infer Yield, infer Return, infer Next>
      ? JSX.GeneratorElement<Yield, Return, Next>
      : never;

type OrdinaryValue<Value> = Exclude<
  Value,
  Generator<unknown, unknown, never> | AsyncGenerator<unknown, unknown, never>
>;

/** Preserve generator union branches and the complete ordinary return type. */
export type ComponentElement<Value> =
  | IteratorElement<Value>
  | ([OrdinaryValue<Value>] extends [never]
      ? never
      : JSX.GeneratorElement<never, OrdinaryValue<Value>, never>);

/**
 * Describe a component while preserving each generator's protocol parameters.
 * Ordinary component values retain their return type and are evaluated by the
 * direct component call.
 */
export function createComponent<Yield, Return, Next>(
  value: Generator<Yield, Return, Next>,
): JSX.GeneratorElement<Yield, Return, Next>;
export function createComponent<Yield, Return, Next>(
  value: AsyncGenerator<Yield, Return, Next>,
): JSX.GeneratorElement<Yield, Return, Next>;
export function createComponent<Value>(value: Value): ComponentElement<Value>;
export function createComponent(value: unknown): unknown {
  return Object.freeze({ kind: 'component', value });
}
