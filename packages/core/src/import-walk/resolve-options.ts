// Bun's own conditions. `types` is left out, because it points at declarations that a clean
// checkout has not built.
export const resolveOptions = {
  conditionNames: ['bun', 'node', 'import', 'require', 'default'],
  extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'],
  extensionAlias: {
    '.js': ['.ts', '.tsx', '.js'],
    '.jsx': ['.tsx', '.jsx'],
    '.mjs': ['.mts', '.mjs'],
    '.cjs': ['.cts', '.cjs'],
  },
  mainFields: ['module', 'main'],
  symlinks: true,
};
