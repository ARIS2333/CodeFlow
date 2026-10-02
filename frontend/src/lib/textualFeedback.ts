import { API_BASE_URL } from '../config/apiConfig.ts';
import { consumeModelStream } from './llmStreamClient.ts';
import type { ModelConfigPayload } from './modelSettings.ts';

export type TextualFeedbackState =
  | { status: 'idle' }
  | { status: 'loading'; markdown: string; requestedInput?: string }
  | { status: 'success'; markdown: string; requestedInput?: string }
  | { status: 'error'; error: string; markdown?: string; requestedInput?: string };

const section = (markdown: string, heading: string): string | null => {
  const marker = `## ${heading}`;
  const start = markdown.indexOf(marker);
  if (start < 0) return null;
  const contentStart = start + marker.length;
  const rest = markdown.slice(contentStart);
  const nextHeading = rest.search(/\n##\s+/);
  return (nextHeading < 0 ? rest : rest.slice(0, nextHeading)).trim();
};

export interface TextualFeedbackSections {
  inputUsed: string | null;
  studentLogic: string | null;
  studentExecution: string | null;
  recommendedLogic: string | null;
  recommendedExecution: string | null;
}

export const textualFeedbackSectionsFrom = (markdown: string): TextualFeedbackSections => ({
  inputUsed: section(markdown, 'Input used'),
  studentLogic: section(markdown, "Student's logic"),
  studentExecution: section(markdown, "Student's execution"),
  recommendedLogic: section(markdown, 'Recommended logic'),
  recommendedExecution: section(markdown, 'Recommended execution'),
});

export const previousTextualLogicFrom = (markdown?: string) => {
  if (!markdown) return null;
  const student = section(markdown, "Student's logic");
  const recommended = section(markdown, 'Recommended logic');
  return student && recommended ? { student, recommended } : null;
};

export const mergeTextualExecutionRegeneration = (
  previousLogic: { student: string; recommended: string },
  executionMarkdown: string,
): string => [
  '## Input used',
  section(executionMarkdown, 'Input used') ?? '',
  "## Student's logic",
  previousLogic.student,
  "## Student's execution",
  section(executionMarkdown, "Student's execution") ?? '',
  '## Recommended logic',
  previousLogic.recommended,
  '## Recommended execution',
  section(executionMarkdown, 'Recommended execution') ?? '',
].join('\n\n');

export const requestTextualFeedback = async (
  problem: unknown,
  code: string,
  modelConfig: ModelConfigPayload,
  onDelta: (markdown: string) => void,
  executionInput?: string,
  previousMarkdown?: string,
  signal?: AbortSignal,
): Promise<string> => {
  const previousLogic = executionInput ? previousTextualLogicFrom(previousMarkdown) : null;
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/textual-feedback/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/x-ndjson',
      },
      body: JSON.stringify({
        problem,
        code,
        language: 'cpp',
        modelConfig,
        ...(executionInput ? { executionInput } : {}),
        ...(previousLogic ? { previousLogic } : {}),
      }),
      signal,
    });
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Could not reach the backend');
  }

  let markdown = '';
  await consumeModelStream(response, (delta) => {
    markdown += delta;
    onDelta(previousLogic ? mergeTextualExecutionRegeneration(previousLogic, markdown) : markdown);
  });
  if (!markdown.trim()) throw new Error('The model returned empty textual feedback');
  return previousLogic ? mergeTextualExecutionRegeneration(previousLogic, markdown) : markdown;
};
