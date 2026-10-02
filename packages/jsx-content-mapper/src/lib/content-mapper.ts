import { parse, parseExpression } from '@babel/parser';
import * as t from '@babel/types';
import {
  MappedCodeBuilder,
  encodedLength,
  stringIndexToPosition,
  type ContentMapperDiagnostic,
  type PositionEncoding,
  type OptionDiagnostic,
  type TransformResult,
} from 'ts-content-mapper';

export interface GtsxOptions {
  /** Generator mode imports createElement, createComponent, and Fragment here. */
  runtimeModule?: string;
  /** Defaults to generator-preserving calls. Classic uses factory(tag, props, ...children). */
  jsxRuntime?: 'generator' | 'classic';
  /** Classic JSX factory in source scope, as with TypeScript's jsxFactory or Babel's pragma. */
  jsxFactory?: string;
  /** Classic fragment value in source scope, as with TypeScript's jsxFragmentFactory. */
  jsxFragmentFactory?: string;
}

export interface TransformGtsxOptions extends GtsxOptions {
  fileName?: string;
  positionEncoding?: PositionEncoding;
}

type Jsx = t.JSXElement | t.JSXFragment;
type JsxChild = t.Expression | { text: string; source: t.JSXText };

function factoryReference(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const reference = (node: t.Node): string | undefined => {
    if (t.isIdentifier(node)) return node.name;
    if (t.isThisExpression(node)) return 'this';
    if (
      t.isMemberExpression(node) &&
      !node.computed &&
      t.isIdentifier(node.property)
    ) {
      const object = reference(node.object);
      if (object !== undefined) return `${object}.${node.property.name}`;
    }
    return undefined;
  };
  try {
    return reference(parseExpression(value, { sourceType: 'module' }));
  } catch {
    return undefined;
  }
}

/** Validate serializable options before the compiler starts mapping files. */
export function validateGtsxOptions(options: GtsxOptions): OptionDiagnostic[] {
  const diagnostics: OptionDiagnostic[] = [];
  if (
    options.runtimeModule !== undefined &&
    (typeof options.runtimeModule !== 'string' || !options.runtimeModule.trim())
  ) {
    diagnostics.push({
      path: ['runtimeModule'],
      messageText: 'runtimeModule must be a nonempty module specifier.',
      code: 3,
    });
  }
  if (
    options.jsxRuntime !== undefined &&
    options.jsxRuntime !== 'generator' &&
    options.jsxRuntime !== 'classic'
  ) {
    diagnostics.push({
      path: ['jsxRuntime'],
      messageText: 'jsxRuntime must be "generator" or "classic".',
      code: 4,
    });
  }
  for (const option of ['jsxFactory', 'jsxFragmentFactory'] as const) {
    if (
      options[option] !== undefined &&
      factoryReference(options[option]) === undefined
    ) {
      diagnostics.push({
        path: [option],
        messageText: `${option} must be an identifier or a dotted reference in source scope.`,
        code: 5,
      });
    } else if (
      options[option] !== undefined &&
      options.jsxRuntime !== 'classic'
    ) {
      diagnostics.push({
        path: [option],
        messageText: `${option} requires jsxRuntime: "classic".`,
        code: 6,
      });
    }
  }
  if (options.jsxRuntime === 'classic' && options.runtimeModule !== undefined) {
    diagnostics.push({
      path: ['runtimeModule'],
      messageText:
        'Classic JSX uses the factory in source scope; import it in the source instead of setting runtimeModule.',
      code: 6,
    });
  }
  return diagnostics;
}

/** Lower JSX to ordinary calls so TypeScript infers each expression's own type. */
export function transformGtsx(
  content: string,
  options: TransformGtsxOptions = {},
): TransformResult {
  const invalidOptions = validateGtsxOptions(options);
  if (invalidOptions.length)
    throw new TypeError(
      invalidOptions.map((diagnostic) => diagnostic.messageText).join('\n'),
    );
  const classic = options.jsxRuntime === 'classic';
  const positionEncoding = options.positionEncoding ?? 'utf-16';
  const builder = new MappedCodeBuilder(content, { positionEncoding });
  const diagnostics: ContentMapperDiagnostic[] = [];

  const reportParseError = (error: unknown) => {
    if (!(error instanceof SyntaxError)) throw error;
    const index =
      'pos' in error && typeof error.pos === 'number' ? error.pos : 0;
    const character = String.fromCodePoint(content.codePointAt(index) ?? 0);
    diagnostics.push({
      messageText: error.message,
      start: stringIndexToPosition(content, index, positionEncoding),
      length:
        index < content.length ? encodedLength(character, positionEncoding) : 0,
      code: 1,
    });
  };

  let ast;
  try {
    ast = parse(content, {
      sourceType: 'module',
      sourceFilename: options.fileName ?? 'module.gtsx',
      plugins: ['typescript', 'jsx', 'decorators'],
      errorRecovery: true,
    });
  } catch (error) {
    reportParseError(error);
    return { ...builder.build('.ts'), diagnostics };
  }
  for (const error of ast.errors ?? []) reportParseError(error);
  if (diagnostics.length) return { ...builder.build('.ts'), diagnostics };

  const jsxNodes: Jsx[] = [];
  t.traverseFast(ast, (node) => {
    if (t.isJSXElement(node) || t.isJSXFragment(node)) jsxNodes.push(node);
  });
  if (!jsxNodes.length)
    return builder.appendVerbatim(0, content.length).build('.ts');

  // Avoid every existing binding, including ones in nested scopes.
  let prefix = '__gtsx';
  while (content.includes(prefix)) prefix += '_';
  const element = `${prefix}_element`;
  const component = `${prefix}_component`;
  const fragment = `${prefix}_fragment`;
  const runtime =
    options.runtimeModule ?? '@causeeffect/jsx-content-mapper/runtime';
  const classicFactory =
    factoryReference(options.jsxFactory) ?? 'React.createElement';
  const classicFragment =
    factoryReference(options.jsxFragmentFactory) ?? 'React.Fragment';

  const positionOf = (node: t.Node, edge: 'start' | 'end'): number => {
    const position = node[edge];
    if (position == null)
      throw new Error(`Missing source position on ${node.type}`);
    return position;
  };
  const startOf = (node: t.Node) => positionOf(node, 'start');
  const endOf = (node: t.Node) => positionOf(node, 'end');

  const emitRange = (start: number, end: number) => {
    let cursor = start;
    for (const node of jsxNodes) {
      if (startOf(node) < cursor || endOf(node) > end) continue;
      builder.appendVerbatim(cursor, startOf(node));
      emitJsx(node);
      cursor = endOf(node);
    }
    builder.appendVerbatim(cursor, end);
  };

  const emitExpression = (node: t.Node) => {
    builder.append('(');
    emitRange(startOf(node), endOf(node));
    builder.append(')');
  };

  const emitName = (node: t.JSXIdentifier | t.JSXNamespacedName) => {
    const name = t.isJSXNamespacedName(node)
      ? `${node.namespace.name}:${node.name.name}`
      : node.name;
    // A computed key avoids the object-literal __proto__ setter.
    const key =
      name === '__proto__' ? `[${JSON.stringify(name)}]` : JSON.stringify(name);
    builder.appendAlias(key, startOf(node), endOf(node));
  };

  const getChildren = (node: Jsx): JsxChild[] => {
    // Babel decodes entities in the parser and normalizes JSX text in buildChildren.
    return node.children.flatMap<JsxChild>((child) => {
      if (t.isJSXExpressionContainer(child)) {
        return t.isJSXEmptyExpression(child.expression)
          ? []
          : [child.expression];
      }
      if (t.isJSXSpreadChild(child)) {
        diagnostics.push({
          messageText:
            'JSX spread children are unsupported; pass an array expression instead.',
          start: stringIndexToPosition(
            content,
            startOf(child),
            positionEncoding,
          ),
          length: encodedLength(
            content.slice(startOf(child), endOf(child)),
            positionEncoding,
          ),
          code: 2,
        });
        return [];
      }
      if (t.isJSXText(child)) {
        return t.react
          .buildChildren(
            t.jsxFragment(t.jsxOpeningFragment(), t.jsxClosingFragment(), [
              child,
            ]),
          )
          .map((text) => ({
            text: (text as t.StringLiteral).value,
            source: child,
          }));
      }
      return [child];
    });
  };

  const emitChild = (child: JsxChild) => {
    if ('text' in child) {
      builder.appendAtom(
        JSON.stringify(child.text),
        startOf(child.source),
        endOf(child.source),
      );
    } else if (t.isJSXElement(child) || t.isJSXFragment(child)) {
      emitJsx(child);
    } else {
      emitExpression(child);
    }
  };

  const emitProps = (node: Jsx, children: JsxChild[] = getChildren(node)) => {
    if (
      classic &&
      (t.isJSXFragment(node) || !node.openingElement.attributes.length)
    ) {
      builder.append('null');
      return;
    }
    builder.append('{');
    if (t.isJSXElement(node)) {
      for (const attribute of node.openingElement.attributes) {
        if (t.isJSXSpreadAttribute(attribute)) {
          builder.append('...');
          emitExpression(attribute.argument);
        } else {
          emitName(attribute.name);
          builder.append(': ');
          const value = attribute.value;
          if (!value) {
            builder.appendAtom(
              'true',
              startOf(attribute.name),
              endOf(attribute.name),
            );
          } else if (t.isStringLiteral(value)) {
            // Match Babel's JSX attribute whitespace normalization.
            builder.appendAtom(
              JSON.stringify(value.value.replace(/\n\s+/g, ' ')),
              startOf(value),
              endOf(value),
            );
          } else if (t.isJSXExpressionContainer(value)) {
            if (t.isJSXEmptyExpression(value.expression)) {
              builder.append('undefined');
            } else {
              emitExpression(value.expression);
            }
          } else {
            emitJsx(value);
          }
        }
        builder.append(', ');
      }
    }

    if (!classic && children.length) {
      builder.append('children: ');
      if (children.length > 1) builder.append('[');
      children.forEach((child, index) => {
        if (index) builder.append(', ');
        emitChild(child);
      });
      if (children.length > 1) builder.append(']');
    }
    builder.append('}');
  };

  const emitJsx = (node: Jsx) => {
    if (classic) {
      builder.append(`${classicFactory}(`);
      if (t.isJSXFragment(node)) {
        builder.append(classicFragment);
      } else {
        const opening = node.openingElement;
        const name = opening.name;
        if (
          t.isJSXNamespacedName(name) ||
          (t.isJSXIdentifier(name) && t.react.isCompatTag(name.name))
        ) {
          const tag = t.isJSXNamespacedName(name)
            ? `${name.namespace.name}:${name.name.name}`
            : (name as t.JSXIdentifier).name;
          builder.appendAlias(JSON.stringify(tag), startOf(name), endOf(name));
        } else {
          builder.appendVerbatim(startOf(name), endOf(name));
          if (opening.typeParameters) {
            builder.appendVerbatim(
              startOf(opening.typeParameters),
              endOf(opening.typeParameters),
            );
          }
        }
      }
      builder.append(', ');
      const children = getChildren(node);
      emitProps(node, children);
      for (const child of children) {
        builder.append(', ');
        emitChild(child);
      }
      builder.append(')');
      return;
    }
    if (t.isJSXFragment(node)) {
      builder.append(`${element}(${fragment}, `);
      emitProps(node);
      builder.append(')');
      return;
    }
    const opening = node.openingElement;
    const name = opening.name;
    const intrinsic =
      t.isJSXNamespacedName(name) ||
      (t.isJSXIdentifier(name) && t.react.isCompatTag(name.name));
    if (intrinsic) {
      const tag = t.isJSXNamespacedName(name)
        ? `${name.namespace.name}:${name.name.name}`
        : (name as t.JSXIdentifier).name;
      builder.append(`${element}(`);
      builder.appendAlias(JSON.stringify(tag), startOf(name), endOf(name));
      builder.append(', ');
      emitProps(node);
      builder.append(')');
    } else {
      builder.append(`${component}(`);
      builder.appendVerbatim(startOf(name), endOf(name));
      if (opening.typeParameters) {
        builder.appendVerbatim(
          startOf(opening.typeParameters),
          endOf(opening.typeParameters),
        );
      }
      builder.append('(');
      if (opening.attributes.length || t.react.buildChildren(node).length) {
        emitProps(node);
      }
      builder.append('))');
    }
  };

  // A hashbang must remain the first line in the virtual source.
  const hashbangEnd = ast.program.interpreter
    ? content.indexOf('\n', endOf(ast.program.interpreter))
    : -1;
  const importStart = hashbangEnd < 0 ? 0 : hashbangEnd + 1;
  builder.appendVerbatim(0, importStart);
  if (!classic) {
    builder.append(
      `import { createElement as ${element}, createComponent as ${component}, Fragment as ${fragment} } from ${JSON.stringify(runtime)};\n`,
    );
  }
  emitRange(importStart, content.length);
  return {
    ...builder.build('.ts'),
    ...(diagnostics.length ? { diagnostics } : {}),
  };
}
