import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { runGit } from '../change-facts/run-git.ts';

const files: Readonly<Record<string, string>> = {
  '.gitignore': 'node_modules/\n.wringer/\n',
  'package.json': '{"name":"fixture","private":true,"workspaces":["packages/*"]}\n',
  'tsconfig.json': '{"compilerOptions":{"paths":{"~/*":["./packages/app/src/*"]}}}\n',
  'packages/app/package.json': '{"name":"@fx/app"}\n',
  'packages/app/src/main.ts': [
    "import { area } from '@fx/lib/area';",
    "import { helper } from './helper.ts';",
    "import { aliased } from '~/aliased.ts';",
    "import { external } from 'ext';",
    '',
    'export const load = (name: string) => import(name);',
    'export const all = [area, helper, aliased, external];',
    '',
  ].join('\n'),
  'packages/app/src/helper.ts': 'export const helper = 1;\n',
  'packages/app/src/aliased.ts': 'export const aliased = 1;\n',
  'packages/app/src/unused.ts': 'export const unused = 1;\n',
  'packages/app/journeys/checkout.md': '# Checkout\n',
  'packages/lib/package.json': JSON.stringify({
    name: '@fx/lib',
    exports: {
      '.': { types: './dist/index.d.ts', default: './src/index.ts' },
      './area': { types: './dist/area.d.ts', default: './src/area.ts' },
    },
  }),
  'packages/lib/src/index.ts': 'export const index = 1;\n',
  'packages/lib/src/area.ts': "import { deep } from './deep.ts';\n\nexport const area = deep;\n",
  'packages/lib/src/deep.ts': 'export const deep = 1;\n',
  'packages/lib/src/sibling.ts': 'export const sibling = 1;\n',
  'node_modules/ext/package.json': '{"name":"ext","main":"index.js"}\n',
  'node_modules/ext/index.js': 'export const external = 1;\n',
};

// Commits a workspace of two packages to the repo's current branch: `app` imports `lib` through its
// `./area` subpath, an alias, a `node_modules` package and one computed `import()`, and `lib` holds
// `sibling.ts`, which nothing imports. The repo must already have a git author set.
export async function seedImportWorkspace(repo: string): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(repo, path)), { recursive: true });
    await writeFile(join(repo, path), text);
  }

  await mkdir(join(repo, 'node_modules', '@fx'), { recursive: true });
  await symlink(join('..', '..', 'packages', 'lib'), join(repo, 'node_modules', '@fx', 'lib'));
  await runGit({ cwd: repo, args: ['add', '.'] });
  await runGit({ cwd: repo, args: ['commit', '--quiet', '-m', 'start'] });
}
