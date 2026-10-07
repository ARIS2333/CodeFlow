import type { ProblemDetails } from '../lib/llmSchemas';

export type StudyGroup = 'A' | 'B';
export type FeedbackMode = 'codeflow' | 'textual';
export type StudyTaskId = 'q1' | 'q2' | 'q3' | 'q4';

export interface StudyTask {
  id: StudyTaskId;
  number: number;
  kind: 'write' | 'debug';
  problem: ProblemDetails;
  starterCode: string;
}

/** Bump only when the actual study questions change, so stale drafts are not
 * restored into a different task while drafts for this task set remain cached. */
export const STUDY_TASK_SET_VERSION = 2;

export const STUDY_TASKS: StudyTask[] = [
  {
    id: 'q1',
    number: 1,
    kind: 'write',
    problem: {
      title: 'Unique Number',
      description: 'A number is **unique** when none of its decimal digits repeat. Write `isNumUnique` to return `true` when every digit in `n` is unique, and `false` otherwise. For a negative number, consider only its digits; the minus sign is not a digit.',
      examples: [
        { input: 'isNumUnique(1234)', output: 'true' },
        { input: 'isNumUnique(1231)', output: 'false' },
        { input: 'isNumUnique(-507)', output: 'true' },
      ],
      constraints: [
        '`INT_MIN <= n <= INT_MAX`.',
        'The sign of a negative number is ignored.',
        'The number `0` contains one digit and is unique.',
      ],
    },
    starterCode: `bool isNumUnique(int n) {\n    // Write your solution here.\n\n}`,
  },
  {
    id: 'q2',
    number: 2,
    kind: 'write',
    problem: {
      title: 'N-Sum: Two Sum',
      description: 'Write `two_sum` to find two different elements whose values add up to `target`. Return their **zero-based indices** as `{i, j}`, with `i < j`. If several pairs work, return the lexicographically earliest pair: the smallest possible `i`, then the smallest possible `j`. Return `{-1, -1}` when no pair exists. Use an `unordered_map` rather than a quadratic nested-loop solution.',
      examples: [
        { input: 'two_sum({2, 7, 11, 15, 0, 18}, 18)', output: '{1, 2}' },
        { input: 'two_sum({3, 12, 11, 5, 15}, 13)', output: '{-1, -1}' },
        { input: 'two_sum({4, 4}, 8)', output: '{0, 1}' },
      ],
      constraints: [
        'The two indices must refer to different elements.',
        'Return indices in ascending order.',
        'Use `unordered_map` in the solution.',
      ],
    },
    starterCode: `#include <vector>\n#include <unordered_map>\n#include <utility>\nusing namespace std;\n\npair<int, int> two_sum(vector<int>& arr, int target) {\n    // Write your solution here.\n\n}`,
  },
  {
    id: 'q3',
    number: 3,
    kind: 'write',
    problem: {
      title: 'Find Digits',
      description: 'The string `y` is created by shuffling all digits of `x` and inserting zero or more additional digits. Write `findTheDigits` to return only the inserted digits, concatenated in ascending order. A digit may be inserted more than once. Use only sets or maps to track digit occurrences.',
      examples: [
        { input: 'findTheDigits("8", "56981234")', output: '"1234569"' },
        { input: 'findTheDigits("1234", "12345")', output: '"5"' },
        { input: 'findTheDigits("12", "2210")', output: '"02"' },
      ],
      constraints: [
        '`0 < x.length()` and `x.length() <= y.length() <= 10^8`.',
        '`y` contains every digit from `x` with the same multiplicity, plus any inserted digits.',
        'Only set or map data structures may be used.',
      ],
    },
    starterCode: `#include <string>\n#include <map>\n\nstd::string findTheDigits(std::string x, std::string y) {\n    // Write your solution here.\n\n}`,
  },
  {
    id: 'q4',
    number: 4,
    kind: 'write',
    problem: {
      title: 'Hashing Mode',
      description: 'The mode is the value that occurs most often. Write `findMode` to return the mode of a nonempty integer vector. If multiple values have the same highest frequency, return the smallest value among them.',
      examples: [
        { input: 'findMode({1, 1, 2, 3, 5, 3, 5, 3})', output: '3' },
        { input: 'findMode({6, 4, 9, 6, 6, 4, 9, 4, 9})', output: '4' },
        { input: 'findMode({5})', output: '5' },
      ],
      constraints: [
        '`nums` contains at least one integer.',
        'Use a hash map to count occurrences.',
        'When frequencies tie, return the smaller value.',
      ],
    },
    starterCode: `#include <iostream>\n#include <vector>\n#include <unordered_map>\n#include <climits>\n\nusing namespace std;\n\nint findMode(vector<int>& nums) {\n    // Write your solution here.\n\n}`,
  },
];

export const feedbackModeFor = (group: StudyGroup, taskId: StudyTaskId): FeedbackMode => {
  const firstStage = taskId === 'q1' || taskId === 'q2';
  return group === 'A'
    ? (firstStage ? 'codeflow' : 'textual')
    : (firstStage ? 'textual' : 'codeflow');
};

export const SURVEY_URLS = {
  s1: 'https://docs.google.com/forms/d/e/1FAIpQLSfnBvJ5kOvudcYIKuTYPA5dWsLU8nLCtMw8Z8kxMrmTmTF-yw/viewform?usp=dialog',
  s2: 'https://docs.google.com/forms/d/e/1FAIpQLScH1EQmejk1q8yZbrbg6KKr6vJl3VkFmZX0mvqaMfIT2S0_rQ/viewform?usp=dialog',
  s3: 'https://docs.google.com/forms/d/e/1FAIpQLSfPnfhO-CQRNw4gtDBzVrslrce6sqcWl1qn3LC3Ncj-fhWZLA/viewform?usp=dialog',
  s4: 'https://docs.google.com/forms/d/e/1FAIpQLSeQIKeT0k6yJ3VSFUvf4rXiCeoiBh5QQm4usFWe6Xj2i1_P9A/viewform?usp=dialog',
} as const;
