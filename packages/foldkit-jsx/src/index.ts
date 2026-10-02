import type {
  Attribute,
  ChildAttribute,
  Html,
  HtmlBuilder,
  TagName,
} from 'foldkit/html';
import type { Config as SubmodelConfig } from 'foldkit/submodel';

/** Content accepted by JSX. Arrays and fragments flatten into Foldkit children. */
export type JsxChild =
  | Html
  | string
  | number
  | bigint
  | boolean
  | undefined
  | ReadonlyArray<JsxChild>;

type ChildlessTag = {
  [Tag in TagName]: Parameters<HtmlBuilder<never>[Tag]>['length'] extends 1
    ? Tag
    : never;
}[TagName];

/** Use Foldkit's attribute constructors so the view's Message type stays intact. */
export type IntrinsicProps<Message, Tag extends TagName> = Readonly<{
  attributes?: Parameters<HtmlBuilder<Message>[Tag]>[0];
  key?: PropertyKey;
  children?: Tag extends ChildlessTag ? never : JsxChild;
}>;

type AnySubmodelView = Parameters<HtmlBuilder<never>['submodel']>[0]['view'];
const submodelComponent = Symbol('Foldkit JSX Submodel');

/** A component bound to the current view's parent Message universe. */
export type SubmodelComponent<Message> = HtmlBuilder<Message>['submodel'] & {
  readonly [submodelComponent]: true;
};

export type Component<Props, Result extends JsxChild = JsxChild> = ((
  props: Props,
) => Result) & {
  readonly [submodelComponent]?: never;
};

type NullableProps<Props> =
  Record<never, never> extends Props ? Props | null : Props;
type ChildrenOf<Props> = Props extends { children?: infer Children }
  ? NonNullable<Children>
  : never;
type ComponentChildren<Props> = [ChildrenOf<Props>] extends [never]
  ? never
  : [ChildrenOf<Props>] extends [ReadonlyArray<JsxChild>]
    ? ChildrenOf<Props>
    : ReadonlyArray<JsxChild> extends ChildrenOf<Props>
      ? ReadonlyArray<JsxChild>
      : never;
type RequiredChildren<Children> = Children extends readonly [
  unknown,
  ...unknown[],
]
  ? Children
  : Children extends ReadonlyArray<infer Child>
    ? readonly [Child, ...Child[]]
    : never;
type ChildArguments<Props> = Props extends { children: unknown }
  ? RequiredChildren<ComponentChildren<Props>>
  : ComponentChildren<Props>;

/** A classic JSX factory, bound to the builder supplied to one Foldkit view. */
export interface CreateElement<Message> {
  <Tag extends TagName>(
    tag: Tag,
    props: IntrinsicProps<Message, NoInfer<Tag>> | null,
    ...children: Tag extends ChildlessTag ? [] : ReadonlyArray<JsxChild>
  ): Html;
  <View extends AnySubmodelView>(
    component: SubmodelComponent<Message>,
    props: SubmodelConfig<View, Message>,
  ): Html;
  <Props, Result extends JsxChild>(
    component: Component<Props, Result>,
    props: NullableProps<NoInfer<Props>>,
  ): Result;
  <Props, Result extends JsxChild>(
    component: Component<Props, Result>,
    props: NullableProps<Omit<NoInfer<Props>, 'children'>>,
    ...children: ChildArguments<NoInfer<Props>>
  ): Result;
}

export interface JsxRuntime<Message> {
  readonly createElement: CreateElement<Message>;
  readonly Fragment: (
    props: Readonly<{ children?: JsxChild }>,
  ) => ReadonlyArray<Html | string>;
  readonly Submodel: SubmodelComponent<Message>;
}

const childlessTags: ReadonlySet<TagName> = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'textarea',
  'track',
  'wbr',
]);

function normalizeChildren(
  children: ReadonlyArray<JsxChild>,
): Array<Html | string> {
  const result: Array<Html | string> = [];

  const append = (child: JsxChild): void => {
    if (Array.isArray(child)) {
      child.forEach(append);
    } else if (typeof child === 'string') {
      result.push(child);
    } else if (typeof child === 'number' || typeof child === 'bigint') {
      result.push(String(child));
    } else if (
      child !== null &&
      child !== undefined &&
      typeof child !== 'boolean'
    ) {
      result.push(child as Html);
    }
  };

  children.forEach(append);
  return result;
}

/**
 * Bind JSX to the current Foldkit view. Create this inside each root or child
 * view, using that view's `h` argument, so handlers keep their dispatch boundary.
 * Configure the mapper with `jsxRuntime: 'classic'`,
 * `jsxFactory: 'jsx.createElement'`, and `jsxFragmentFactory: 'jsx.Fragment'`.
 */
export function createJsx<Message>(
  h: HtmlBuilder<Message>,
): JsxRuntime<Message> {
  const Fragment = ({ children }: Readonly<{ children?: JsxChild }>) =>
    normalizeChildren([children]);

  const Submodel = Object.assign(
    <View extends AnySubmodelView>(
      config: SubmodelConfig<View, Message>,
    ): Html => h.submodel(config),
    { [submodelComponent]: true as const },
  );

  const createElement = (
    tag: unknown,
    rawProps: unknown,
    ...children: ReadonlyArray<JsxChild>
  ): JsxChild => {
    const props = (rawProps ?? {}) as Record<string, unknown>;
    const effectiveChildren =
      children.length > 0 ? children : [props['children'] as JsxChild];

    if (typeof tag === 'function') {
      const component = tag as (props: Record<string, unknown>) => JsxChild;
      return component(children.length > 0 ? { ...props, children } : props);
    }

    if (
      typeof tag !== 'string' ||
      !Object.hasOwn(h, tag) ||
      tag === 'submodel' ||
      tag === 'keyed' ||
      tag[0] !== tag[0]?.toLowerCase() ||
      typeof h[tag as TagName] !== 'function'
    ) {
      throw new TypeError(`Unsupported Foldkit JSX element: ${String(tag)}`);
    }

    for (const name of Object.keys(props)) {
      if (name !== 'attributes' && name !== 'key' && name !== 'children') {
        throw new TypeError(
          `Foldkit JSX elements accept attributes, key and children; received ${name}`,
        );
      }
    }

    const name = tag as TagName;
    const attributes = (props['attributes'] ?? []) as ReadonlyArray<
      Attribute<Message> | ChildAttribute
    >;
    const normalized = normalizeChildren(effectiveChildren);
    const childless = childlessTags.has(name);
    if (childless && normalized.length > 0) {
      throw new TypeError(
        name === 'textarea'
          ? 'Foldkit textarea content must use h.Value, not JSX children'
          : `Foldkit ${name} elements cannot have JSX children`,
      );
    }

    const key = props['key'] as PropertyKey | undefined;
    if (key !== undefined) {
      const keyed = h.keyed(name) as (
        key: PropertyKey,
        attributes: ReadonlyArray<Attribute<Message> | ChildAttribute>,
        children?: ReadonlyArray<Html | string>,
      ) => Html;
      return childless || normalized.length === 0
        ? keyed(key, attributes)
        : keyed(key, attributes, normalized);
    }

    const element = h[name] as (
      attributes: ReadonlyArray<Attribute<Message> | ChildAttribute>,
      children?: ReadonlyArray<Html | string>,
    ) => Html;
    return childless || normalized.length === 0
      ? element(attributes)
      : element(attributes, normalized);
  };

  return {
    createElement: createElement as CreateElement<Message>,
    Fragment,
    Submodel,
  };
}
