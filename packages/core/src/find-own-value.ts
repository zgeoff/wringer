// A key from outside the program, such as a target or stream named `constructor`, would read a
// value every object inherits; only the record's own keys count.
export function findOwnValue<Value>(
  record: Readonly<Record<string, Value>>,
  key: string,
): Value | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}
