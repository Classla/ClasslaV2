# Design Document

## Overview

The Interactive Assignment Editor feature extends the existing assignment system with rich content editing capabilities. It consists of two main components: AssignmentEditor for instructors and AssignmentViewer for students. The design leverages TipTap editor with custom extensions to create interactive blocks, starting with Multiple Choice Questions (MCQ).

## Architecture

### Component Structure

```
AssignmentPage.tsx
├── AssignmentEditor.tsx (for instructors)
│   ├── TipTap Editor with Extensions
│   ├── MCQ Block Extension
│   ├── Slash Command Menu
│   └── Floating Toolbar
└── AssignmentViewer.tsx (for students)
    ├── TipTap Editor (read-only)
    ├── MCQ Block Viewer
    └── Interactive Elements
```

### Data Flow

1. **Editor Mode**: Instructor creates/edits content → Auto-save to assignment.content → API update
2. **Viewer Mode**: Student loads assignment → Render content → Handle interactions locally
3. **Block Data**: All interactive block data stored within TipTap node attributes

## Components and Interfaces

### AssignmentEditor Component

```typescript
interface AssignmentEditorProps {
  assignment: Assignment;
  onAssignmentUpdated: (assignment: Assignment) => void;
  isReadOnly?: boolean;
}
```

**Features:**

- TipTap editor with StarterKit extensions (based on CourseEditor implementation)
- Custom MCQ block extension (extends CourseEditor's slash command system)
- Slash command menu with MCQ block option (inherits CourseEditor's slash command infrastructure)
- Floating toolbar for text formatting (reuses CourseEditor's floating toolbar)
- Auto-save functionality with debouncing (follows CourseEditor's auto-save pattern)
- Block controls (add, drag, delete) using CourseEditor's block control system

### AssignmentViewer Component

```typescript
interface AssignmentViewerProps {
  assignment: Assignment;
  onAnswerChange?: (blockId: string, answer: any) => void;
}
```

**Features:**

- Read-only TipTap editor
- Interactive MCQ blocks for answer selection
- Answer state management
- Visual feedback for selections

### MCQ Block Extension

```typescript
interface MCQBlockData {
  id: string;
  question: string;
  options: Array<{
    id: string;
    text: string;
    isCorrect: boolean;
  }>;
  allowMultiple: boolean;
  points: number;
  explanation?: string;
}
```

**Editor Features:**

- Question text editing
- Add/remove/reorder options
- Mark correct answers
- Configure points and explanation
- Drag handle for reordering

**Viewer Features:**

- Display question and options
- Single/multiple selection based on configuration
- Visual selection feedback
- Answer state persistence during session

## Data Models

### Assignment Content Structure

The assignment content will be stored as HTML with embedded JSON data in custom node attributes:

```html
<div
  data-type="mcq-block"
  data-mcq='{"id":"mcq-1","question":"What is 2+2?","options":[{"id":"opt-1","text":"3","isCorrect":false},{"id":"opt-2","text":"4","isCorrect":true}],"allowMultiple":false,"points":1}'
>
  <!-- Rendered MCQ content -->
</div>
```

### TipTap Node Schema

```typescript
const MCQNode = Node.create({
  name: "mcqBlock",
  group: "block",
  content: "inline*",

  addAttributes() {
    return {
      mcqData: {
        default: null,
        parseHTML: (element) =>
          JSON.parse(element.getAttribute("data-mcq") || "{}"),
        renderHTML: (attributes) => ({
          "data-mcq": JSON.stringify(attributes.mcqData),
        }),
      },
    };
  },
});
```

### Answer State Management

For the viewer, answer states will be managed locally:

```typescript
interface AnswerState {
  [blockId: string]: {
    selectedOptions: string[];
    timestamp: Date;
  };
}
```

## Error Handling

### Editor Error Scenarios

1. **Save Failures**: Display toast notification, retry mechanism
2. **Invalid Block Data**: Validation before save, fallback to previous state
3. **Network Issues**: Offline indicator, queue changes for retry

### Viewer Error Scenarios

1. **Malformed Content**: Graceful degradation, show error message for affected blocks
2. **Missing Block Data**: Display placeholder with error message
3. **Interaction Failures**: Visual feedback, maintain local state

## Testing Strategy

### Unit Tests

1. **MCQ Block Extension**

   - Data serialization/deserialization
   - Option management (add/remove/reorder)
   - Correct answer validation

2. **AssignmentEditor Component**

   - Auto-save functionality
   - Slash command integration
   - Block insertion and editing

3. **AssignmentViewer Component**
   - Answer selection logic
   - State management
   - Read-only enforcement

### Integration Tests

1. **Editor-Viewer Consistency**

   - Content created in editor displays correctly in viewer
   - Interactive elements function as expected
   - Data persistence across save/load cycles

2. **API Integration**
   - Assignment content save/load
   - Error handling for network failures
   - Auto-save behavior

### E2E Tests

1. **Instructor Workflow**

   - Create assignment with MCQ blocks
   - Edit existing MCQ questions
   - Copy/paste MCQ blocks

2. **Student Workflow**
   - View assignment with MCQ blocks
   - Select answers and see visual feedback
   - Navigate between questions

## Implementation Phases

### Phase 1: Core Infrastructure

- Create AssignmentEditor and AssignmentViewer components using CourseEditor as reference
- Integrate TipTap editor with basic extensions (copy CourseEditor's extension setup)
- Implement component switching based on user role in AssignmentPage

### Phase 2: MCQ Block Extension

- Create custom TipTap extension for MCQ blocks
- Implement editor interface for question creation
- Add viewer interface for answer selection

### Phase 3: Integration and Polish

- Integrate with existing assignment system
- Add auto-save functionality
- Implement error handling and loading states

### Phase 4: Testing and Refinement

- Add comprehensive test coverage
- Performance optimization
- User experience improvements

## Security Considerations

1. **Input Validation**: Sanitize all user input in MCQ blocks
2. **XSS Prevention**: Proper HTML escaping for user-generated content
3. **Data Integrity**: Validate MCQ data structure before save
4. **Access Control**: Ensure students cannot access editor mode

## Performance Considerations

1. **Auto-save Debouncing**: Prevent excessive API calls during editing
2. **Large Content Handling**: Efficient rendering for assignments with many blocks
3. **Memory Management**: Proper cleanup of editor instances
4. **Bundle Size**: Code splitting for editor vs viewer components
