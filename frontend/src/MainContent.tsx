import { useState, useEffect, useRef } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { java } from '@codemirror/lang-java';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { autocompletion, CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { keymap } from '@codemirror/view';
import { completionKeymap } from '@codemirror/autocomplete';
import { vscodeDark } from '@uiw/codemirror-theme-vscode';
import ReactMarkdown from 'react-markdown';
import UploadPopup from './UploadPopup';
import { systemPrompt_GenerateFeedback } from './config/systemPrompt_GenerateFeedback';
import { requestStructured } from './lib/llmClient';
import { requestReliableFlowchart } from './lib/flowchartClient';
import {
  startAnalysisRun,
  type AnalysisRun,
  type EvaluationState,
  type FlowchartState,
} from './lib/analysisRun';
import {
  validateCodeEvaluation,
  type ProblemDetails,
  type TestResult,
} from './lib/llmSchemas';

interface MainContentProps {
  flowchartState: FlowchartState;
  onFlowchartStateChange: (state: FlowchartState) => void;
  onRunStart: () => void;
}

// Java keywords for autocompletion
const javaKeywords = [
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const', 'continue',
  'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float', 'for', 'goto', 'if',
  'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new', 'package', 'private',
  'protected', 'public', 'return', 'short', 'static', 'strictfp', 'super', 'switch', 'synchronized', 'this',
  'throw', 'throws', 'transient', 'try', 'void', 'volatile', 'while', 'true', 'false', 'null'
];

// Python keywords for autocompletion
const pythonKeywords = [
  'and', 'as', 'assert', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'exec',
  'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'not', 'or', 'pass', 'print',
  'raise', 'return', 'try', 'while', 'with', 'yield', 'True', 'False', 'None'
];

// JavaScript keywords for autocompletion
const jsKeywords = [
  'abstract', 'arguments', 'await', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const',
  'continue', 'debugger', 'default', 'delete', 'do', 'double', 'else', 'enum', 'eval', 'export', 'extends',
  'false', 'final', 'finally', 'float', 'for', 'function', 'goto', 'if', 'implements', 'import', 'in',
  'instanceof', 'int', 'interface', 'let', 'long', 'native', 'new', 'null', 'package', 'private', 'protected',
  'public', 'return', 'short', 'static', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws',
  'transient', 'true', 'try', 'typeof', 'var', 'void', 'volatile', 'while', 'with', 'yield'
];

// Autocompletion function for Java
const javaCompletion = (context: CompletionContext): CompletionResult | null => {
  const word = context.matchBefore(/\w*/);
  if (!word || (word.from == word.to && !context.explicit)) return null;

  const options = javaKeywords.map(keyword => ({
    label: keyword,
    type: "keyword"
  }));

  return {
    from: word.from,
    options
  };
};

// Autocompletion function for Python
const pythonCompletion = (context: CompletionContext): CompletionResult | null => {
  const word = context.matchBefore(/\w*/);
  if (!word || (word.from == word.to && !context.explicit)) return null;

  const options = pythonKeywords.map(keyword => ({
    label: keyword,
    type: "keyword"
  }));

  return {
    from: word.from,
    options
  };
};

// Autocompletion function for JavaScript
const jsCompletion = (context: CompletionContext): CompletionResult | null => {
  const word = context.matchBefore(/\w*/);
  if (!word || (word.from == word.to && !context.explicit)) return null;

  const options = jsKeywords.map(keyword => ({
    label: keyword,
    type: "keyword"
  }));

  return {
    from: word.from,
    options
  };
};

export const MainContent = ({ flowchartState, onFlowchartStateChange, onRunStart }: MainContentProps) => {
  const [code, setCode] = useState(`public int MyFunction(int a, int b) {
  // Change the input variable and the return type of the function as needed.
  // Press "Enter" to choose the keyword, not "Tab".

}`);
  const [language, setLanguage] = useState<'java' | 'python'>('java');
  const [evaluationState, setEvaluationState] = useState<EvaluationState>({ status: 'idle' });
  const activeRun = useRef<AnalysisRun | null>(null);
  const isCodeEvaluating = evaluationState.status === 'loading';
  const isRunning = isCodeEvaluating || flowchartState.status === 'loading';
  const codeEvaluation = evaluationState.status === 'success' ? evaluationState.data : null;
  const codeEvaluationError = evaluationState.status === 'error' ? evaluationState.error : null;

  useEffect(() => () => activeRun.current?.cancel(), []);

  const clearResults = () => {
    activeRun.current?.cancel();
    activeRun.current = null;
    setEvaluationState({ status: 'idle' });
    onFlowchartStateChange({ status: 'idle' });
  };

  // Update code when language changes
  useEffect(() => {
    if (language === 'python') {
      setCode(`def MyFunction(a, b):
  # Change the input variable as needed.
  # Press "Enter" to choose the keyword, not "Tab".
  `);
    } else {
      setCode(`public int MyFunction(int a, int b) {
  // Change the input variable and the return type of the function as needed.
  // Press "Enter" to choose the keyword, not "Tab".

}`);
    }
  }, [language]);
  const [isUploadPopupOpen, setIsUploadPopupOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [problemDetails, setProblemDetails] = useState<ProblemDetails | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [isApiProcessing, setIsApiProcessing] = useState(false);
  const isRunDisabled = isRunning || !problemDetails || isApiProcessing || isLoading;

  const handleUpload = (content: string, problemDetails: ProblemDetails | null, error: string | null) => {
    clearResults();
    setIsLoading(true);
    // Simulate a small delay for UI consistency
    setTimeout(() => {
      setProblem(content);
      setProblemDetails(problemDetails);
      setApiError(error);
      setIsLoading(false);
    }, 500);
  };

  const handleRunCode = () => {
    // Keep the run button locked until both tasks settle, but display each
    // task's result as soon as it is ready. The ref also guards double clicks.
    if (activeRun.current?.isRunning() || isRunDisabled || !problemDetails) return;

    activeRun.current?.cancel();
    onRunStart();

    // Evaluation remains independent. Flowcharts use parser grounding for clean
    // source, or source-only inference when parsing reports syntax recovery.
    const requestPayload = {
      practice: {
        title: problemDetails.title,
        description: problemDetails.description,
        examples: problemDetails.examples,
        constraints: problemDetails.constraints
      },
      language: language,
      code: code
    };
    const message = JSON.stringify(requestPayload);

    activeRun.current = startAnalysisRun({
      requestFeedback: () => requestStructured({
        systemPrompt: systemPrompt_GenerateFeedback,
        message,
        validate: validateCodeEvaluation,
        label: 'feedback'
      }),
      requestFlowchart: (onGenerationReady) =>
        requestReliableFlowchart(requestPayload, onGenerationReady),
      onFeedbackChange: setEvaluationState,
      onFlowchartChange: onFlowchartStateChange,
    });
  };

  // Create extensions with autocompletion enabled for all languages
  const getExtensions = () => {
    const baseExtensions = [
      autocompletion({override: [
        language === 'java' ? javaCompletion :
        language === 'python' ? pythonCompletion :
        jsCompletion
      ]}),
      keymap.of([
        // Add completion keymap for Tab key
        ...completionKeymap
      ])
    ];

    if (language === 'java') {
      return [...baseExtensions, java()];
    } else if (language === 'python') {
      return [...baseExtensions, python()];
    } else {
      return [...baseExtensions, javascript()];
    }
  };

  return (
    <>
      <main className="flex-1 p-8">
      <div className="max-w-6xl mx-auto">
        {/* Combined Practice Problem and Analysis Section */}
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Practice Problem</h2>
          <button
            onClick={() => setIsUploadPopupOpen(true)}
            disabled={isApiProcessing}
            className={`px-4 py-2 rounded-md text-white transition-colors mb-4 ${
              isApiProcessing
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {isApiProcessing ? 'Processing...' : 'Upload'}
          </button>
        </div>

        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          {/* Loading state when popup is closed but API is still processing */}
          {isApiProcessing && !isUploadPopupOpen && (
            <div className="flex justify-center items-center h-32">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
              <span className="ml-3 text-gray-600">Processing with AI...</span>
            </div>
          )}

          {/* Loading state - only show spinner without problem content */}
          {isLoading && !isApiProcessing && (
            <div className="flex justify-center items-center h-32">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
              <span className="ml-3 text-gray-600">Processing with AI...</span>
            </div>
          )}

          {/* Error state */}
          {apiError && !isLoading && !isApiProcessing && (
            <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-r-lg">
              <p className="text-red-700">
                <span className="font-semibold">Error:</span> {apiError}
              </p>
            </div>
          )}

          {/* Display only problem analysis from API */}
          {problemDetails && !isLoading && !apiError && !isApiProcessing && (
            <div className="space-y-6">
              <div>
                <h3 className="text-xl font-semibold text-gray-800 mb-2">{problemDetails.title}</h3>
                <div className="text-gray-700 leading-relaxed">
                  <ReactMarkdown
                    components={{
                      p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                      strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
                      ul: ({ children }) => <ul className="list-disc list-inside mb-2">{children}</ul>,
                      ol: ({ children }) => <ol className="list-decimal list-inside mb-2">{children}</ol>,
                      code: ({ children }) => <code className="bg-gray-100 px-1 py-0.5 rounded text-sm font-mono">{children}</code>,
                    }}
                  >
                    {problemDetails.description}
                  </ReactMarkdown>
                </div>
              </div>

              <div>
                <h4 className="text-lg font-semibold text-gray-800 mb-3">Examples</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {[...problemDetails.examples, ...Array(Math.max(0, 3 - problemDetails.examples.length)).fill(null)].slice(0, 3).map((example, index) => (
                    <div key={index} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                      {example ? (
                        <>
                          <div className="font-medium text-gray-900 mb-2">Example {index + 1}</div>
                          <div className="text-sm">
                            <div className="mb-1"><span className="font-medium">Input:</span> {example.input}</div>
                            <div><span className="font-medium">Output:</span> {example.output}</div>
                          </div>
                        </>
                      ) : (
                        <div className="text-gray-500 italic">Example {index + 1} (empty)</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* No problem uploaded yet */}
          {!problem && !isLoading && !isApiProcessing && (
            <div className="bg-gray-50 border-l-4 border-gray-300 p-4 rounded-r-lg">
              <p className="text-gray-600 italic">No problem uploaded yet. Please upload a practice problem.</p>
            </div>
          )}

          {/* Show loading when popup is open and API is processing */}
          {isApiProcessing && isUploadPopupOpen && (
            <div className="flex justify-center items-center h-32">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
              <span className="ml-3 text-gray-600">Processing with AI...</span>
            </div>
          )}
        </div>

        {/* Upload Popup */}
        <UploadPopup
          isOpen={isUploadPopupOpen}
          onClose={() => setIsUploadPopupOpen(false)}
          onUpload={handleUpload}
          onApiProcessingChange={setIsApiProcessing} // New prop
        />

        {/* Code Editor Section */}
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          {/* Editor Header */}
          <div className="bg-gray-800 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="flex space-x-2">
                <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                <div className="w-3 h-3 bg-green-500 rounded-full"></div>
              </div>
              <span className="text-gray-300 text-sm ml-4">
                {language === 'java' ? 'Solution.java' : 'Solution.py'}
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <select
                value={language}
                onChange={(e) => {
                  clearResults();
                  setLanguage(e.target.value as 'java' | 'python');
                }}
                className="bg-gray-700 text-white text-sm rounded px-2 py-1"
              >
                <option value="java">Java</option>
                <option value="python">Python</option>
              </select>
              <button
                onClick={handleRunCode}
                disabled={isRunDisabled}
                className={`px-4 py-2 text-white text-sm rounded-md transition-colors ${
                  isRunDisabled
                    ? 'bg-gray-500 cursor-not-allowed'
                    : 'bg-green-600 hover:bg-green-700'
                }`}
              >
                {isRunning ? 'Running...' : 'Run Code'}
              </button>
            </div>
          </div>

          {/* CodeMirror Editor */}
          <div className="min-h-[400px]">
            <CodeMirror
              value={code}
              height="400px"
              extensions={getExtensions()}
              theme={vscodeDark}
              onChange={(value) => setCode(value)}
              className="text-sm"
            />
          </div>

          {/* Editor Footer */}
          <div className="bg-gray-800 px-4 py-2 flex items-center justify-between text-sm text-gray-400">
            <div className="flex items-center space-x-4">
              <span className="capitalize">{language}</span>
              <span>UTF-8</span>
              <span>Ln {code.split('\n').length}, Col 1</span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="w-2 h-2 bg-green-500 rounded-full"></span>
              <span>Ready</span>
            </div>
          </div>
        </div>

        {/* Output Section */}
        <div className="bg-gray-900 rounded-xl mt-4 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-white font-semibold">Output</h3>
            <button
              className="text-gray-400 hover:text-white text-sm"
              onClick={clearResults}
            >
              Clear
            </button>
          </div>
          <div aria-busy={isCodeEvaluating} className="bg-black rounded p-3 text-green-400 font-mono text-sm min-h-[100px]">
            {isCodeEvaluating ? (
              <div role="status" className="flex items-center">
                <div aria-hidden="true" className="animate-spin rounded-full h-4 w-4 border-b-2 border-green-500 mr-2"></div>
                <span>Evaluating your code...</span>
              </div>
            ) : evaluationState.status === 'error' ? (
              <div role="alert" className="text-red-400">
                <div className="font-bold text-red-300">Error:</div>
                <div>{codeEvaluationError}</div>
              </div>
            ) : codeEvaluation ? (
              <div className="space-y-2">
                <div className={`font-bold ${codeEvaluation.IsCorrect ? 'text-green-400' : 'text-red-400'}`}>
                  Code Status: {codeEvaluation.IsCorrect ? 'CORRECT' : 'INCORRECT'}
                </div>
                <div>
                  <div className="font-bold text-gray-300 mb-1">Test Results:</div>
                  <div className="space-y-1">
                    {codeEvaluation.TestResults.map((test: TestResult, index: number) => (
                      <div key={index} className="flex items-start">
                        <span className="mr-2">
                          {test.yourOutput.includes('✅') ? '✅' :
                           test.yourOutput.includes('❌ Compile Error') ? '🔧' : '❌'}
                        </span>
                        <span className="flex-1">
                          <span className="text-gray-300">Input:</span> {test.input} →
                          <span className="text-gray-300"> Expected:</span> {test.expected} →
                          <span className="text-gray-300"> Output:</span> {test.yourOutput}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-gray-500">// Click "Run Code" to see output</div>
            )}
          </div>
        </div>
      </div>
    </main>
    </>
  );
};
