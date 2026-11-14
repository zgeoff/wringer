import { expect, test } from 'bun:test';
import { pickVisibleText } from './pick-visible-text.ts';

test('#pickVisibleText drops the rows that scrolled off the top', () => {
  expect(pickVisibleText('a\nb\nc\nd', 6, 3)).toBe('d');
});

test('#pickVisibleText keeps every row when the terminal has not scrolled', () => {
  expect(pickVisibleText('a\nb', 3, 3)).toBe('a\nb');
});
