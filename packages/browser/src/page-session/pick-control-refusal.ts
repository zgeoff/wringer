export interface ControlFacts {
  readonly kind: 'checkbox' | 'radio' | 'other';
  readonly disabled: boolean;
}

// A tick or an untick only makes sense on an enabled checkbox or radio, and a radio only ticks.
// The answer is the message of the usage error, or null when the control takes the action.
export function pickControlRefusal(facts: ControlFacts, checked: boolean): string | null {
  if (facts.kind === 'other') {
    return 'The element is not a checkbox or a radio button.';
  }

  if (facts.disabled) {
    return 'The control is disabled.';
  }

  if (facts.kind === 'radio' && !checked) {
    return 'A radio button cannot be unchecked; check another radio of its group instead.';
  }

  return null;
}
