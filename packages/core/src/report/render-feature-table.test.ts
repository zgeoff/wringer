import { expect, test } from 'bun:test';
import { renderFeatureTable } from './render-feature-table.ts';

test('it renders one row per feature, in the order given, with a relative link to its file', () => {
  const table = renderFeatureTable([
    { name: 'brew', summary: 'Brew a pot', paths: ['src/brew/**'] },
    { name: 'pour', summary: 'Pour a cup', paths: ['src/pour/**'] },
  ]);

  expect(table).toBe(
    [
      '| Feature | Summary | File |',
      '| --- | --- | --- |',
      '| brew | Brew a pot | [references/feature-brew.md](references/feature-brew.md) |',
      '| pour | Pour a cup | [references/feature-pour.md](references/feature-pour.md) |',
    ].join('\n'),
  );
});

test('it escapes a pipe in a summary and folds a line break to a space', () => {
  const table = renderFeatureTable([
    { name: 'brew', summary: 'Brew | steep\nthe leaves', paths: ['src/**'] },
  ]);

  expect(table.split('\n')[2]).toBe(
    String.raw`| brew | Brew \| steep the leaves | [references/feature-brew.md](references/feature-brew.md) |`,
  );
});

test('it renders only the header for a registry with no features', () => {
  expect(renderFeatureTable([])).toBe('| Feature | Summary | File |\n| --- | --- | --- |');
});

test('it escapes a backslash before a pipe, so the row keeps its three cells', () => {
  const table = renderFeatureTable([
    { name: 'brew', summary: String.raw`Brew \| pour`, paths: ['src/**'] },
  ]);

  expect(table.split('\n')[2]).toBe(
    String.raw`| brew | Brew \\\| pour | [references/feature-brew.md](references/feature-brew.md) |`,
  );

  const html = Bun.markdown.html(table);

  expect(html.match(/<td>/gu)).toHaveLength(3);
  expect(html).toContain(String.raw`<td>Brew \| pour</td>`);
});

test('it escapes a pipe in a feature name in the name cell, the link text and the link target', () => {
  const table = renderFeatureTable([{ name: 'brew|steep', summary: 'Brew', paths: ['src/**'] }]);

  expect(table.split('\n')[2]).toBe(
    String.raw`| brew\|steep | Brew | [references/feature-brew\|steep.md](references/feature-brew\|steep.md) |`,
  );

  const html = Bun.markdown.html(table);

  expect(html.match(/<td>/gu)).toHaveLength(3);

  expect(html).toContain(
    '<td>brew|steep</td><td>Brew</td><td><a href="references/feature-brew%7Csteep.md">references/feature-brew|steep.md</a></td>',
  );
});
