import { expect, test } from 'bun:test';
import { findSnapshotElement } from './find-snapshot-element.ts';

test('it reads the role and name of a ref', () => {
  const snapshot = [
    '- generic [active] [ref=e1]:',
    '  - heading "Shop" [level=1] [ref=e2]',
    '  - button "Place order" [ref=e5]',
  ].join('\n');

  expect(findSnapshotElement(snapshot, 'e5')).toStrictEqual({
    role: 'button',
    name: 'Place order',
  });
});

test('it unescapes a quote inside the name', () => {
  const snapshot = String.raw`  - button "Place \"big\" order" [active] [ref=e5]`;

  expect(findSnapshotElement(snapshot, 'e5')).toStrictEqual({
    role: 'button',
    name: 'Place "big" order',
  });
});

test.each([
  { case: 'a colon', line: `  - 'button "Order: confirm" [ref=e2]'`, name: 'Order: confirm' },
  { case: 'a doubled quote', line: `  - 'button "it''s #1: ok" [ref=e2]'`, name: "it's #1: ok" },
])('it reads a single-quoted key that holds $case', (row) => {
  expect(findSnapshotElement(row.line, 'e2')).toStrictEqual({ role: 'button', name: row.name });
});

test.each([
  { case: 'a field value', line: '  - textbox "Search terms" [ref=e3]: "[ref=e5]"' },
  { case: 'a name', line: '  - button "Copy [ref=e5]" [ref=e3]' },
])('it never reads a ref out of $case', (row) => {
  const snapshot = [row.line, '  - button "Place order" [ref=e5]'].join('\n');

  expect(findSnapshotElement(snapshot, 'e5')).toStrictEqual({
    role: 'button',
    name: 'Place order',
  });
});

test('it gives an element with no name an empty name', () => {
  expect(findSnapshotElement('- generic [ref=e3]:', 'e3')).toStrictEqual({
    role: 'generic',
    name: '',
  });
});

test('it returns null for a ref the snapshot lacks', () => {
  expect(findSnapshotElement('- button "Pay" [ref=e5]', 'e50')).toBeNull();
});
