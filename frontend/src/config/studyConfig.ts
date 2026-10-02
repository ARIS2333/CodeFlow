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

export const STUDY_TASKS: StudyTask[] = [
  {
    id: 'q1',
    number: 1,
    kind: 'write',
    problem: {
      title: 'Count Even Numbers',
      description: 'Write `countEvens` to return how many values in an integer vector are even.',
      examples: [
        { input: 'countEvens({1, 2, 3, 4})', output: '2' },
        { input: 'countEvens({2, 2, 2})', output: '3' },
        { input: 'countEvens({1, 3, 5})', output: '0' },
      ],
      constraints: ['The vector may be empty.', 'Values may be negative or zero.'],
    },
    starterCode: `#include <vector>\nusing namespace std;\n\nint countEvens(const vector<int>& nums) {\n    // Write your solution here.\n\n}`,
  },
  {
    id: 'q2',
    number: 2,
    kind: 'debug',
    problem: {
      title: 'First Repeated Value',
      description: 'Debug `firstRepeated` so it returns the first value whose second occurrence is encountered while scanning left to right. Return `-1` when no value repeats.',
      examples: [
        { input: 'firstRepeated({2, 5, 1, 5, 2})', output: '5' },
        { input: 'firstRepeated({3, 3, 4})', output: '3' },
        { input: 'firstRepeated({1, 2, 3})', output: '-1' },
      ],
      constraints: ['The vector contains integers.', 'Keep the supplied function signature.'],
    },
    starterCode: `#include <vector>\n#include <unordered_set>\nusing namespace std;\n\nint firstRepeated(const vector<int>& nums) {\n    unordered_set<int> seen;\n    for (int value : nums) {\n        if (seen.count(value) == 0) {\n            return value;\n        }\n        seen.insert(value);\n    }\n    return -1;\n}`,
  },
  {
    id: 'q3',
    number: 3,
    kind: 'write',
    problem: {
      title: 'Longest Positive Streak',
      description: 'Write `longestPositiveStreak` to return the length of the longest consecutive run of positive values.',
      examples: [
        { input: 'longestPositiveStreak({1, 2, -1, 3, 4, 5})', output: '3' },
        { input: 'longestPositiveStreak({-2, 0, -1})', output: '0' },
        { input: 'longestPositiveStreak({7, 8})', output: '2' },
      ],
      constraints: ['Zero is not positive.', 'The vector may be empty.'],
    },
    starterCode: `#include <vector>\nusing namespace std;\n\nint longestPositiveStreak(const vector<int>& nums) {\n    // Write your solution here.\n\n}`,
  },
  {
    id: 'q4',
    number: 4,
    kind: 'debug',
    problem: {
      title: 'Smallest Mode',
      description: 'Debug `findMode` so it returns the most frequent value. If several values have the same frequency, return the smallest one.',
      examples: [
        { input: 'findMode({1, 1, 2, 3, 3, 3})', output: '3' },
        { input: 'findMode({4, 6, 4, 6})', output: '4' },
        { input: 'findMode({5})', output: '5' },
      ],
      constraints: ['The vector contains at least one integer.', 'Keep the supplied function signature.'],
    },
    starterCode: `#include <vector>\n#include <unordered_map>\n#include <climits>\nusing namespace std;\n\nint findMode(const vector<int>& nums) {\n    unordered_map<int, int> frequency;\n    for (int value : nums) {\n        frequency[value]++;\n    }\n\n    int mode = INT_MAX;\n    int maxCount = 0;\n    for (const auto& entry : frequency) {\n        if (entry.second >= maxCount) {\n            maxCount = entry.second;\n            mode = entry.first;\n        }\n    }\n    return mode;\n}`,
  },
];

export const feedbackModeFor = (group: StudyGroup, taskId: StudyTaskId): FeedbackMode => {
  const firstStage = taskId === 'q1' || taskId === 'q2';
  return group === 'A'
    ? (firstStage ? 'codeflow' : 'textual')
    : (firstStage ? 'textual' : 'codeflow');
};

export const SURVEY_URLS = {
  mid1: 'https://forms.gle/example-mid-survey-1',
  mid2: 'https://forms.gle/example-mid-survey-2',
  post: 'https://forms.gle/example-post-survey',
} as const;
