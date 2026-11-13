import { expect, test } from 'bun:test';
import { maxDescriptionChars, resolveSpanBudget } from './resolve-span-budget.ts';

test('it leaves the limit less the margin for an empty description, and the heading a new span adds', () => {
  const result = resolveSpanBudget('');

  expect(result.ok && result.budgetChars).toBeWithin(
    maxDescriptionChars - 1024 - 100,
    maxDescriptionChars - 1024 + 1,
  );
});

test('it takes every character outside an existing span out of the budget', () => {
  const span = '<!-- wringer:report -->\nold\n<!-- /wringer:report -->';
  const bare = resolveSpanBudget(span);
  const padded = resolveSpanBudget(`${'a'.repeat(1000)}\n${span}\n${'b'.repeat(500)}`);

  expect({
    bare: bare.ok && bare.budgetChars,
    padded: padded.ok && padded.budgetChars,
  }).toStrictEqual({ bare: maxDescriptionChars - 1024, padded: maxDescriptionChars - 1024 - 1502 });
});

test('it counts the same characters outside the span for a CRLF description', () => {
  const span = '<!-- wringer:report -->\r\nold\r\n<!-- /wringer:report -->';
  const result = resolveSpanBudget(`intro\r\n${span}\r\n`);

  expect(result.ok && result.budgetChars).toBe(maxDescriptionChars - 1024 - 9);
});

test('it never goes below zero for a description that fills the limit', () => {
  const result = resolveSpanBudget('x'.repeat(70_000));

  expect(result).toStrictEqual({ ok: true, budgetChars: 0 });
});

test('it refuses a description with two opening markers', () => {
  const result = resolveSpanBudget('<!-- wringer:report -->\n<!-- wringer:report -->');

  expect(result).toStrictEqual({
    ok: false,
    reason: 'The description holds 2 opening wringer report markers; it must hold one.',
  });
});
