import { dirname, join, relative, sep } from 'node:path';
import type { ResolverFactory } from 'oxc-resolver';
import type { RepoHost } from '../types.ts';
import { collectImportSpecifiers } from './collect-import-specifiers.ts';
import type { LiteralImport } from './collect-import-specifiers.ts';
import { isMissingFile } from './is-missing-file.ts';
import { isParsedFile } from './is-parsed-file.ts';
import type { OxcParserModule } from './oxc-parser-module.ts';
import { readOxcParser } from './read-oxc-parser.ts';
import { requireOptions, resolveOptions } from './resolve-options.ts';
import { toLineNumber } from './to-line-number.ts';

export interface ReachedFiles {
  // Root-relative paths with `/` separators, sorted, entries included.
  readonly reached: readonly string[];
  readonly warnings: readonly string[];
}

export interface ReachRequest {
  readonly root: string;

  // Root-relative paths of the files the walk starts from.
  readonly entryFiles: readonly string[];
}

export type ReachHost = Pick<RepoHost, 'readText' | 'inspectFile'>;

// Follows the imports from each entry file, through the files under the root, and stops at a
// `node_modules` folder. A path no import resolves, such as a built-in module, is not followed.
export async function readReachedFiles(
  host: ReachHost,
  request: ReachRequest,
): Promise<ReachedFiles> {
  const oxc = await readOxcParser();
  const resolverModule = await import('oxc-resolver');
  const rootFacts = await host.inspectFile(request.root);

  const realRoot = rootFacts?.realPath ?? request.root;

  const baseResolver = new resolverModule.ResolverFactory(resolveOptions);

  const requireResolver = baseResolver.cloneWithOptions(requireOptions);

  const tsconfigs = new Map<string, string | null>();
  const resolvers = new Map<string, ResolverFactory>();
  const reached = new Set<string>(request.entryFiles);

  const warnings: string[] = [];
  const queue = [...request.entryFiles];

  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const found = await readImports(host, { oxc, realRoot, file: next });

    warnings.push(...found.warnings);

    for (const literal of found.specifiers) {
      const tsconfig = await readTsconfig(host, {
        realRoot,
        folder: dirname(next),
        known: tsconfigs,
      });

      const resolver = readResolver({ import: baseResolver, require: requireResolver }, resolvers, {
        kind: literal.kind,
        tsconfig,
      });

      const target = pickTarget(resolver, { realRoot, file: next, specifier: literal.specifier });

      if (target !== null && !reached.has(target)) {
        reached.add(target);
        queue.push(target);
      }
    }
  }

  return { reached: [...reached].toSorted(), warnings: warnings.toSorted() };
}

interface ImportsRequest {
  readonly oxc: OxcParserModule;
  readonly realRoot: string;
  readonly file: string;
}

async function readImports(
  host: ReachHost,
  request: ImportsRequest,
): Promise<{ specifiers: readonly LiteralImport[]; warnings: readonly string[] }> {
  if (!isParsedFile(request.file)) {
    return { specifiers: [], warnings: [] };
  }

  const source = await readSource(host, join(request.realRoot, request.file));

  if (source === null) {
    return { specifiers: [], warnings: [] };
  }

  const parsed = request.oxc.parseSync(request.file, source);
  const found = collectImportSpecifiers(request.oxc, parsed.program);

  return {
    specifiers: found.literals,
    warnings: found.dynamicOffsets.map(
      (offset) =>
        `${request.file}:${toLineNumber(source, offset)}: an import() with a path that is not a literal, so the walk cannot follow it`,
    ),
  };
}

// A path that is gone, such as a file git lists that a change deleted, has no imports.
async function readSource(host: ReachHost, path: string): Promise<string | null> {
  try {
    return await host.readText(path);
  } catch (error) {
    if (isMissingFile(error)) {
      return null;
    }

    throw error;
  }
}

interface TsconfigRequest {
  readonly realRoot: string;

  // A root-relative folder, `.` for the root itself.
  readonly folder: string;
  readonly known: Map<string, string | null>;
}

// The nearest `tsconfig.json` from a folder up to the root, which is the file Bun reads the `paths`
// of for a file in that folder.
async function readTsconfig(host: ReachHost, request: TsconfigRequest): Promise<string | null> {
  const known = request.known.get(request.folder);

  if (known !== undefined) {
    return known;
  }

  const candidate = join(request.realRoot, request.folder, 'tsconfig.json');

  const facts = await host.inspectFile(candidate);

  let found: string | null = null;

  if (facts?.isRegularFile === true) {
    found = candidate;
  } else if (request.folder !== '.') {
    found = await readTsconfig(host, { ...request, folder: dirname(request.folder) });
  }

  request.known.set(request.folder, found);

  return found;
}

interface ResolverRequest {
  readonly kind: LiteralImport['kind'];
  readonly tsconfig: string | null;
}

// A resolver for each kind of import and each tsconfig, sharing the base resolver's cache.
function readResolver(
  bases: Readonly<Record<LiteralImport['kind'], ResolverFactory>>,
  resolvers: Map<string, ResolverFactory>,
  request: ResolverRequest,
): ResolverFactory {
  const base = bases[request.kind];

  if (request.tsconfig === null) {
    return base;
  }

  const key = `${request.kind}\0${request.tsconfig}`;

  const known =
    resolvers.get(key) ??
    base.cloneWithOptions({
      ...(request.kind === 'require' ? requireOptions : resolveOptions),
      tsconfig: { configFile: request.tsconfig },
    });

  resolvers.set(key, known);

  return known;
}

interface TargetRequest {
  readonly realRoot: string;
  readonly file: string;
  readonly specifier: string;
}

function pickTarget(resolver: ResolverFactory, request: TargetRequest): string | null {
  const resolved = resolver.resolveFileSync(
    join(request.realRoot, request.file),
    request.specifier,
  );

  if (resolved.path === undefined) {
    return null;
  }

  const target = relative(request.realRoot, resolved.path).split(sep);

  return target[0] === '..' || target.includes('node_modules') ? null : target.join('/');
}
