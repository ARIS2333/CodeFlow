import type { ProblemDetails } from '../lib/llmSchemas';

export const EXAMPLE_PROBLEM_SOURCE = `Write a function in Java that implements the following logic: Given a number n, return true if n is in the range 1..10, inclusive. Unless outsideMode is true, in which case return true if the number is less than or equal to 1, or greater than or equal to 10.`;

export const EXAMPLE_PROBLEM_DETAILS: ProblemDetails = {
  title: 'In 1 to 10',
  description: 'Given a number `n`, return `true` if `n` is in the range 1..10, inclusive. Unless `outsideMode` is `true`, in which case return `true` when the number is less than or equal to 1, or greater than or equal to 10.',
  examples: [
    { input: 'n = 5, outsideMode = false', output: 'true' },
    { input: 'n = 11, outsideMode = false', output: 'false' },
    { input: 'n = 11, outsideMode = true', output: 'true' },
  ],
  constraints: [
    '`n` is an integer.',
    'When `outsideMode` is false, only values from 1 through 10 are accepted.',
    'When `outsideMode` is true, only values at or beyond the two boundaries are accepted.',
  ],
};

export const EXAMPLE_SUBMISSION = `public boolean in1To10(int n, boolean outsideMode) {
    if (n >= 1 && n <= 10) {
        return true;
    } else if (outsideMode = true) {
        if (n <= 1 || n >= 10) {
            return true;
        }
    } else {
        return false;
    }
}`;
