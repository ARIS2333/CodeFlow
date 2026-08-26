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

### Flowchart Visualization
The flowchart functionality ([FlowchartDiagram.tsx](src/FlowchartDiagram.tsx)) provides:
- Visual representation of code logic flow
- Error highlighting in student's implementation
- Comparison between student's solution and recommended approach
- Interactive re-layout capability

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