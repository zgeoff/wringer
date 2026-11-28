import type { Expression, Program, StringLiteral } from 'oxc-parser';
import type { OxcParserModule } from './oxc-parser-module.ts';

export interface LiteralImport {
  readonly specifier: string;

  // Which conditions of a package's `exports` apply: `require()` reads `require`, the rest `import`.
  readonly kind: 'import' | 'require';
}

export interface ImportSpecifiers {
  // Each literal path a file imports: static imports, `export ... from`, `import()` and `require`.
  readonly literals: readonly LiteralImport[];

  // The offset in the source of each `import()` whose path is not a literal.
  readonly dynamicOffsets: readonly number[];
}

export function collectImportSpecifiers(oxc: OxcParserModule, program: Program): ImportSpecifiers {
  const literals: LiteralImport[] = [];
  const dynamicOffsets: number[] = [];

  const addLiteral = (
    node: Expression | StringLiteral | null | undefined,
    kind: LiteralImport['kind'] = 'import',
  ): void => {
    const found = findLiteral(node);

    if (found !== null) {
      literals.push({ specifier: found, kind });
    }
  };

  const visitor = new oxc.Visitor({
    ImportDeclaration: (node) => {
      addLiteral(node.source);
    },
    ExportNamedDeclaration: (node) => {
      addLiteral(node.source);
    },
    ExportAllDeclaration: (node) => {
      addLiteral(node.source);
    },
    ImportExpression: (node) => {
      const literal = findLiteral(node.source);

      if (literal === null) {
        dynamicOffsets.push(node.start);
      } else {
        literals.push({ specifier: literal, kind: 'import' });
      }
    },
    CallExpression: (node) => {
      const [first] = node.arguments;

      if (
        node.callee.type === 'Identifier' &&
        node.callee.name === 'require' &&
        first?.type !== 'SpreadElement'
      ) {
        addLiteral(first, 'require');
      }
    },
  });

  visitor.visit(program);

  return { literals, dynamicOffsets };
}

// The text of a string, or of a template with no placeholder; null for any other expression.
function findLiteral(node: Expression | StringLiteral | null | undefined): string | null {
  if (node?.type === 'Literal' && typeof node.value === 'string') {
    return node.value;
  }

  const [onlyPart] =
    node?.type === 'TemplateLiteral' && node.expressions.length === 0 ? node.quasis : [];

  return onlyPart?.value.cooked ?? null;
}
