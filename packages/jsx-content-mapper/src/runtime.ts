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

/** Describe a generator component while preserving its yield, return and next. */
export function createComponent<Yield, Return, Next>(
  value: Generator<Yield, Return, Next>,
): JSX.GeneratorElement<Yield, Return, Next>;
export function createComponent<Yield, Return, Next>(
  value: AsyncGenerator<Yield, Return, Next>,
): JSX.GeneratorElement<Yield, Return, Next>;
/** Ordinary components retain their return type and are evaluated by the call. */
export function createComponent<Return>(
  value: Return,
): JSX.GeneratorElement<never, Return, never>;
export function createComponent(
  value: unknown,
): JSX.GeneratorElement<unknown, unknown, unknown> {
  return Object.freeze({ kind: 'component', value });
}
