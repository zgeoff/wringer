// A consumer reads this number before any other envelope field, so a breaking change to the
// envelope's shape raises it.
export const envelopeVersion = 1;
