// An integer a JavaScript number holds exactly stays a number. Any other becomes a string of its
// decimal digits, which a JSON envelope can carry where a bigint throws.
export function toSafeInteger(value: bigint): number | string {
  const asNumber = Number(value);

  return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
}
