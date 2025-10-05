# Submission History UI Implementation

## Overview

Added a submission history dropdown in the assignment header that allows students to view and switch between their past submissions when resubmissions are enabled.

## Features

### 1. Submission History Dropdown

**Location**: Purple assignment header, next to "Status:"

**Behavior**:

- Shows when student has 1+ submissions
- Displays chevron icon when multiple submissions exist
- Click to open popover with submission list
- Automatically updates when new submissions are created

### 2. Submission List Display

Each submission shows:

- **Label**: "Latest Submission" or "Submission N"
- **Timestamp**: Formatted date and time
- **Status Badge**: Color-coded (In Progress/Submitted/Graded)
- **Grade**: Shown if graded
- **Selection Indicator**: Purple border on selected submission

### 3. Submission Switching

- Click any submission to view it
- Content updates to show that submission's answers
- Status and timestamp update in header
- Selected submission persists until changed

## UI Components

### Header Dropdown

```tsx
<Popover
  trigger={
    <button className="flex items-center space-x-2">
      <span>Status: {status}</span>
      {allSubmissions.length > 1 && <ChevronDown />}
    </button>
  }
  content={<SubmissionHistoryList />}
/>
```

### Submission List Item

```tsx
<button
  onClick={() => selectSubmission(sub.id)}
  className={
    selectedSubmissionId === sub.id
      ? "bg-purple-50 border-l-4 border-purple-600"
      : ""
  }
>
  <div className="flex items-start justify-between">
    <div>
      <Clock /> {label}
      <p>{timestamp}</p>
    </div>
    <span className="badge">{status}</span>
  </div>
</button>
```

## Status Badge Colors

| Status      | Background             | Text                     |
| ----------- | ---------------------- | ------------------------ |
| In Progress | Blue (bg-blue-100)     | Blue (text-blue-700)     |
| Submitted   | Green (bg-green-100)   | Green (text-green-700)   |
| Graded      | Purple (bg-purple-100) | Purple (text-purple-700) |

## Data Flow

### 1. Initial Load

```
AssignmentPage loads
  ↓
Fetch all submissions for assignment
  ↓
Filter to current user's submissions
  ↓
Sort by timestamp (newest first)
  ↓
Set latest as selected
  ↓
Display in viewer
```

### 2. Submission Creation

```
Student clicks "Start Assignment" or "Resubmit"
  ↓
Create new submission via API
  ↓
Add to allSubmissions array
  ↓
Set as selected submission
  ↓
Refresh submissions list
```

### 3. Submission Selection

```
Student clicks submission in dropdown
  ↓
Update selectedSubmissionId
  ↓
Update submissionId, status, timestamp
  ↓
AssignmentViewer re-renders with new submission
  ↓
Content shows selected submission's answers
```

## State Management

### AssignmentPage State

```typescript
const [allSubmissions, setAllSubmissions] = useState<any[]>([]);
const [selectedSubmissionId, setSelectedSubmissionId] = useState<
  string | undefined
>();
const [submissionId, setSubmissionId] = useState<string | undefined>();
const [submissionStatus, setSubmissionStatus] = useState<string | null>(null);
const [submissionTimestamp, setSubmissionTimestamp] = useState<
  Date | string | null
>(null);
```

### Submission Object

```typescript
{
  id: string;
  assignment_id: string;
  student_id: string;
  status: "in-progress" | "submitted" | "graded";
  timestamp: Date | string;
  values: Record<string, string[]>;
  grade?: number;
  grader_id?: string;
}
```

## User Experience

### Single Submission

- No dropdown chevron shown
- Status displayed as plain text
- No interaction needed

### Multiple Submissions

- Chevron icon indicates dropdown
- Click to see all submissions
- Latest submission selected by default
- Can switch between submissions
- Each submission preserves its answers

### With Resubmissions Enabled

1. Student submits assignment
2. Clicks "Resubmit" button
3. New submission created (in-progress)
4. Dropdown now shows 2 submissions
5. Can switch back to view previous submission
6. Can continue working on new submission

### With Resubmissions Disabled

1. Student submits assignment
2. "Resubmit" button hidden
3. Only one submission in list
4. No dropdown interaction

## Integration Points

### Files Modified

- `classla-frontend/src/pages/AssignmentPage.tsx`

  - Added submission history state
  - Added dropdown UI in header
  - Updated fetch logic to get all submissions
  - Added submission selection handler

- `classla-frontend/src/components/AssignmentViewer.tsx`

  - Added `studentId` prop for randomization
  - Integrated randomization logic
  - Receives selected submission via props

- `classla-frontend/src/utils/randomization.ts`
  - Created deterministic randomization utilities
  - Supports question order randomization per student

### API Endpoints Used

- `GET /submissions/by-assignment/:assignmentId` - Fetch all submissions
- `POST /submission` - Create new submission
- `POST /submission/:id/submit` - Submit a submission

## Styling

### Dropdown Container

```css
.w-80 max-h-96 overflow-y-auto;
```

### Header Section

```css
.p-3 border-b bg-gray-50;
```

### Submission Item

```css
.w-full p-3 text-left hover:bg-gray-50 transition-colors
```

### Selected Item

```css
.bg-purple-50 border-l-4 border-purple-600;
```

### Status Badge

```css
.text-xs px-2 py-1 rounded-full font-medium;
```

## Accessibility

- **Keyboard Navigation**: Dropdown accessible via keyboard
- **Screen Readers**: Proper labels and ARIA attributes
- **Focus Management**: Focus returns to trigger after selection
- **Color Contrast**: All text meets WCAG AA standards

## Performance Considerations

### Optimization Strategies

1. **Lazy Loading**: Only fetch submissions when needed
2. **Memoization**: Submission list sorted once
3. **Efficient Updates**: Only re-render when selection changes
4. **Minimal Re-fetches**: Cache submissions list

### Memory Usage

- Stores all user submissions in memory
- Typical: 1-5 submissions per assignment
- Each submission: ~1-5KB
- Total: Negligible impact

## Future Enhancements

### 1. Submission Comparison

- Side-by-side view of two submissions
- Highlight differences in answers
- Show grade progression

### 2. Submission Notes

- Add notes to each submission
- Track what changed between submissions
- Instructor feedback per submission

### 3. Submission Analytics

- Time spent on each submission
- Answer change tracking
- Performance trends

### 4. Bulk Operations

- Delete old submissions
- Export submission history
- Download all submissions as PDF

### 5. Advanced Filtering

- Filter by status
- Filter by date range
- Search within submissions

## Testing Checklist

- [x] Dropdown appears with multiple submissions
- [x] Latest submission selected by default
- [x] Can switch between submissions
- [x] Content updates when switching
- [x] Status badge shows correct color
- [x] Grade displayed when available
- [x] Timestamp formatted correctly
- [x] New submissions added to list
- [x] Dropdown hidden with single submission
- [x] Works with resubmissions enabled/disabled

## Related Documentation

- `RESUBMISSION_FIX.md` - Resubmission logic
- `RANDOMIZE_QUESTIONS_IMPLEMENTATION.md` - Question randomization
- `ASSIGNMENT_SETTINGS_IMPLEMENTATION.md` - Assignment settings

## Notes

- Submissions are sorted newest first
- Only shows current user's submissions
- Preserves all submission data for audit trail
- Works seamlessly with question randomization
- Compatible with all assignment settings
