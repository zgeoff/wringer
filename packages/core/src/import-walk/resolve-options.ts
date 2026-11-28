// Bun's own conditions, and the order it tries extensions in, which differs for `require()`. `types` is left out, because it
// points at declarations that a clean checkout has not built.
export const resolveOptions = {
  conditionNames: ['bun', 'node', 'import', 'default'],
  extensions: ['.tsx', '.jsx', '.mts', '.ts', '.mjs', '.js', '.cts', '.cjs', '.json'],
  extensionAlias: {
    '.js': ['.ts', '.tsx', '.js'],
    '.jsx': ['.tsx', '.jsx'],
    '.mjs': ['.mts', '.mjs'],
    '.cjs': ['.cts', '.cjs'],
  },
  mainFields: ['module', 'main'],
  symlinks: true,
};

export const requireOptions = {
  ...resolveOptions,
  conditionNames: ['bun', 'node', 'require', 'default'],
  extensions: ['.tsx', '.ts', '.jsx', '.cts', '.cjs', '.js', '.mjs', '.mts', '.json'],
};
