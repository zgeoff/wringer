// gunshi swaps an empty string for a string flag's default, which is undefined here, so `--label ''`
// would reach the schema as a missing flag. A string flag passes this parse function to keep the
// value as typed.
export function keepFlagText(value: string): string {
  return value;
}
