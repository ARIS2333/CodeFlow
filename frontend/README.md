# CodeFlowchart - Interactive Code Practice and Evaluation Tool

This is a React-based application designed to help developers practice coding problems, receive automated feedback, and visualize their code logic through interactive flowcharts. The tool provides an integrated environment for coding, evaluation, and learning.

## Features

- **Practice Problem Section**: View and upload coding practice problems with structured formatting
- **Code Editor**: Built-in code editor with syntax highlighting for Java and Python solutions
- **Upload Functionality**: Upload custom practice problems via popup interface with AI processing
- **Code Evaluation**: Run and evaluate your code solutions against practice problems with automated feedback
- **Flowchart Visualization**: Visualize code logic flows using interactive diagrams with error highlighting
- **Dual Flowchart Comparison**: Compare student's implementation with recommended solution for learning
- **Mobile Responsive**: Adapts layout for mobile devices with collapsible sidebar
- **System Prompts Configuration**: Pre-configured system prompts for AI processing of code and problems
- **Resizable Right Panel**: Adjustable panel width for optimal viewing experience

## Project Structure

```
src/
├── components/
│   └── ui/              # Reusable UI components
│       ├── breadcrumb.tsx
│       ├── button.tsx
│       ├── input.tsx
│       ├── separator.tsx
│       ├── sheet.tsx
│       ├── sidebar.tsx
│       ├── skeleton.tsx
│       └── tooltip.tsx
├── config/              # Configuration files
│   ├── panelConfig.ts
│   ├── systemPrompt_GenerateFeedback.ts
│   ├── systemPrompt_GenerateFlowchart.ts
│   └── systemPrompt_HandlePractice.ts
├── hooks/               # Custom React hooks
│   └── use-mobile.ts
├── lib/                 # Utility functions
│   └── utils.ts
├── App.tsx             # Main application component
├── FlowchartDiagram.tsx # Component for displaying interactive flowcharts
├── Layout.tsx          # Overall page layout with resizable panel
├── Header.tsx          # Application header with panel toggle
├── MainContent.tsx     # Primary content area with practice problem and code editor
├── RightContent.tsx    # Content for the right panel
├── RightPanel.tsx      # Resizable right panel component
├── UploadPopup.tsx     # Component for uploading custom practice problems
├── index.css           # Global CSS styles
├── main.tsx            # Application entry point
└── vite-env.d.ts       # Vite environment types
```

## Key Components

### Main Content Area
The main content area ([MainContent.tsx](src/MainContent.tsx)) contains:
- Practice problem display with examples
- Code editor with support for Java and Python
- Run button to execute code and receive feedback
- Output panel showing evaluation results

Each run starts evaluation and flowchart generation independently. Output shows
the evaluation loader; Code Analysis opens automatically and shows the flowchart
loader (including Tree-sitter preprocessing). Each panel displays its own result
or error as soon as its task finishes, without waiting for the other panel.
Closing Code Analysis does not stop generation. Run Code stays disabled while
either task is pending. Clear, changing languages, or replacing the problem
clears both panels and aborts evaluation, flowchart/trace streaming, and manual
re-trace requests. Unmounting also aborts the active requests.

Run `npm test` (Node.js 22.6+ with type stripping) for the independent completion,
failure isolation, and stale-response regression tests; these make no LLM calls.

The API defaults to `http://127.0.0.1:5001` during local development. Set
`VITE_API_BASE_URL` when building for a separate backend, as shown in
`.env.example` and the repository's `DEPLOYMENT.md`.

### Flowchart Visualization
The flowchart functionality ([FlowchartDiagram.tsx](src/FlowchartDiagram.tsx)) provides:
- Visual representation of code logic flow
- Error highlighting in student's implementation
- Comparison between student's solution and recommended approach
- Interactive re-layout capability

Flowchart generation selects its mode before the first model request:

1. The backend uses error-tolerant Tree-sitter grammars to extract ordered,
   source-positioned facts from the exact Java/Python submission.
2. For a clean parse, the LLM must cover each required parser fact through
   validated source anchors while generating the student and reference graphs.
3. If parsing reports recovery or syntax issues, the first LLM request instead
   uses the original code and advisory diagnostics, without parser facts or
   anchor constraints. The student graph is a tentative interpretation, not a
   silent correction of the student's logic. No second LLM reviewer is added.
4. Both modes validate graph structure, reachability, terminals, and edge
   references. Only grounded mode validates source anchors. Invalid output can
   still trigger the existing maximum of three generation attempts.

Flowcharts use `POST /api/resource/stream`; evaluation and exercise uploads keep
using the non-streaming `/api/resource` endpoint. The model streams one JSON
object, with `missingSymbols` first (in inferred mode), then `student`, then
`llm`. The frontend incrementally decodes NDJSON transport frames and scans JSON
delimiters while respecting strings and escapes. It does not parse incomplete
JSON or add guessed closing brackets.

- Each complete missing-symbol suggestion is source-checked and displayed early.
- Each complete graph is locally validated and laid out independently. The
  other graph keeps its own loader; no per-token layout is performed.
- Receiving the other graph or final response preserves existing node positions.
- Output-format retries clear both graph previews before the next attempt;
  graphs from different attempts are never combined. Already validated graphs
  survive a connection failure, alongside a "Generation incomplete" notice.
- Transport failures do not automatically trigger another generation. A final
  `done` frame and complete, validated JSON are both required for overall success.
  The client aborts an attempt after 200 seconds; the backend has a 180-second
  generation deadline and emits heartbeats while waiting for the provider.

In inferred mode, parser diagnostics remain available to the generation pipeline
but are not displayed in the panel. Anchor-dependent automatic token marking is disabled in this mode;
locatable model-provided syntax marks remain supported. Clear/new runs ignore
late diagnostic updates as well as late graphs.

The same inferred-mode model response also requests `missingSymbols`: suspected
missing punctuation, a 1-based source line, an exact nearby text anchor, whether
the symbol belongs before/after that anchor, and a short explanation. Suggestions
appear above the diagrams under "Possible missing symbols detected", with one
compact line per symbol and its source reference. Explanation paragraphs, code
blocks, and parser details are not displayed; the panel stays hidden until there
is a model suggestion to show. Their line/anchor must match the original
submission uniquely; unmatched or ambiguous references are shown as unlocated
instead of inventing a location. This is a source-reference check, not proof that
the proposed repair is correct. No code is changed automatically.

These optional suggestions do not add an LLM call and cannot reject an otherwise
valid graph. Once received, they also survive graph-validation failures; an
explicit empty report on a later attempt replaces the earlier suggestions.
Malformed later feedback does not erase a usable earlier report. This feedback
only covers missing syntax punctuation, not operator or logic corrections.

This switch does not detect errors the parser itself misses: `clean` is not a
guarantee that the source compiles or is correct. Parser API failures still
surface as request errors rather than being mistaken for student syntax errors.

Rendering then uses **ELK Layered** for node placement and orthogonal edge routing:

- React Flow measures the existing node boxes and handles before layout; this
  does not change node content, sizing styles, or the viewport's fit policy.
- Control-flow analysis identifies back edges and prioritizes the main path.
  ELK receives fixed connection ports and computes both positions and bend points.
  The renderer uses those bend points directly, including branch-label positions.
- Layout runs in a lazily loaded worker. Each diagram shows its own arranging
  indicator; stale results cannot replace a newer graph. Failure or a 15-second
  timeout falls back to the previous Dagre layout with a visible retry notice.
- Nodes remain draggable. Connected edges follow manual moves; **Re-Layout**
  recalculates the full diagram. Incidental parent renders preserve manual moves.

This stage does not call an LLM, change graph connections, or add missing `for`
initialization/update nodes. Those are separate generation concerns.

`npm test` includes mocked generation/validation tests for clean and recovered
code, UTF-8/frame splitting, incremental JSON, partial graph rendering, stream
interruption/cancellation, diagnostics across request states, and stale-response isolation. These do
not call a live LLM. Backend tests exercise actual Tree-sitter recovery for the
missing-brace examples and invalid Python conditions.

It also includes layout regression cases for the palindrome example, nested
loops, branch joins, break/continue paths, post-tested loops, real handle bounds,
multiline nodes, stable re-layout, input preservation, and worker failures.

### Right Panel
The right panel ([RightPanel.tsx](src/RightPanel.tsx), [RightContent.tsx](src/RightContent.tsx)) features:
- Toggleable design for optimal screen usage
- Resizable width for custom viewing experience
- Dual flowchart display for comparing implementations
- Collapsible panel for mobile responsiveness

### Configuration System
The config folder contains system prompts that define how the AI processes:
- Practice problems ([systemPrompt_HandlePractice.ts](src/config/systemPrompt_HandlePractice.ts))
- Code feedback ([systemPrompt_GenerateFeedback.ts](src/config/systemPrompt_GenerateFeedback.ts))
- Flowchart generation ([systemPrompt_GenerateFlowchart.ts](src/config/systemPrompt_GenerateFlowchart.ts))

## How It Works

1. **Upload a Problem**: Users can upload coding practice problems through the upload popup, which uses AI to parse and structure the problem.

2. **Code Solutions**: Using the built-in code editor, users can write solutions in Java or Python with syntax highlighting and autocompletion.

3. **Run and Evaluate**: When users run their code, the application sends the problem description, language, and code to backend services for evaluation.

4. **Receive Feedback**: Users get immediate feedback on their solution including:
   - Whether their solution is correct
   - Test results with inputs and expected vs actual outputs
   - Flowchart visualization of their code logic

5. **Visualize Logic**: The application generates two flowcharts:
   - Student's implementation (with error highlighting)
   - Recommended solution (error-free)
   
   This allows users to compare their approach with the ideal solution.

## Technical Details

- **Frontend Framework**: React with TypeScript
- **State Management**: React hooks for local state management
- **Styling**: Tailwind CSS for responsive design
- **Code Editor**: @uiw/react-codemirror for code editing capabilities
- **Flowchart Library**: @xyflow/react for diagram visualization
- **Layout**: Responsive design with resizable panels
- **API Integration**: Fetch API for communication with backend services

## Getting Started

1. Clone the repository
2. Install dependencies with `npm install`
3. Start the development server with `npm run dev`
4. Open your browser to the provided local address

## Use Cases

- **Self-directed Learning**: Practice coding problems and receive immediate feedback
- **Code Review**: Visualize code logic to identify potential issues
- **Education**: Instructors can provide structured problems and students can get detailed feedback
- **Interview Preparation**: Practice common coding interview problems with detailed evaluation

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
