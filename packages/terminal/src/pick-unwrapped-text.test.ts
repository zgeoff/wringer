import { expect, test } from 'bun:test';
import { pickUnwrappedText } from './pick-unwrapped-text.ts';

test('#pickUnwrappedText joins the rows of a wrapped line', () => {
  expect(pickUnwrappedText('abcde\nfg\nhi', ['abcdefg', 'hi'], 3, 3)).toBe('abcdefg\nhi');
});

test('#pickUnwrappedText keeps only the visible rows of a line that began above the screen', () => {
  expect(pickUnwrappedText('abcde\nfghij\nkl\nmn', ['abcdefghijkl', 'mn'], 4, 2)).toBe('kl\nmn');
});

test('#pickUnwrappedText keeps an empty line as an empty row', () => {
  expect(pickUnwrappedText('ab\n\ncd', ['ab', '', 'cd'], 3, 3)).toBe('ab\n\ncd');
});
