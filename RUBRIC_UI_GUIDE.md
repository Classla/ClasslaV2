# Rubric System UI Guide

## User Flow

### For Teachers: Creating a Rubric

1. **Navigate to Assignment Settings**

   - Open an assignment
   - Click the settings icon in the right sidebar
   - Scroll to "Grading Rubric" section
   - Click to expand the section

2. **Configure Rubric**

   ```
   ┌─────────────────────────────────────────┐
   │ Grading Rubric                    ▼     │
   ├─────────────────────────────────────────┤
   │ Rubric Title                            │
   │ [Grading Rubric________________]        │
   │                                         │
   │ Rubric Type                             │
   │ [Checkbox (All or Nothing)    ▼]        │
   │ Students receive full points or zero    │
   │ for each criterion                      │
   │                                         │
   │ ☑ Use rubric score in final grade      │
   │                                         │
   │ Criteria                    [+ Add]     │
   │ ┌─────────────────────────────────┐    │
   │ │ ≡ [Criterion description____]   │    │
   │ │   Points: [5___]                🗑   │
   │ └─────────────────────────────────┘    │
   │ ┌─────────────────────────────────┐    │
   │ │ ≡ [Missing citations________]   │    │
   │ │   Points: [-2__] (Deduction)    🗑   │
   │ └─────────────────────────────────┘    │
   │                                         │
   │ [Create Rubric]                         │
   └─────────────────────────────────────────┘
   ```

3. **Rubric Types**

   **Checkbox Rubric:**

   - Each criterion is all-or-nothing
   - Can have negative points (deductions)
   - Visual: Checkboxes
   - Example: "Includes introduction (+5 pts)"
   - Example: "Missing citations (-2 pts)"

   **Numerical Rubric:**

   - Each criterion has a scale (0 to max)
   - Only positive points allowed
   - Visual: Number inputs
   - Example: "Code quality (0-10 pts)"

### For Teachers: Grading with a Rubric

1. **Open Grading Panel**

   - Open an assignment
   - Click the eye icon in the right sidebar
   - Select a student from the list

2. **View Grading Interface**

   ```
   ┌─────────────────────────────────────────┐
   │ Grading Controls                        │
   ├─────────────────────────────────────────┤
   │ Autograded Score    Raw Rubric Score    │
   │ [8.5]               [0]                 │
   │                                         │
   │ Score Modifier      Final Grade         │
   │ [0_____]            [8.5]               │
   ├─────────────────────────────────────────┤
   │ Essay Grading Rubric        5 / 15 pts  │
   ├─────────────────────────────────────────┤
   │ ┌─────────────────────────────────┐    │
   │ │ ☑ Clear thesis statement        │    │
   │ │   +5 pts                        │    │
   │ └─────────────────────────────────┘    │
   │ ┌─────────────────────────────────┐    │
   │ │ ☐ Supporting evidence           │    │
   │ │   +5 pts                        │    │
   │ └─────────────────────────────────┘    │
   │ ┌─────────────────────────────────┐    │
   │ │ ☐ Proper conclusion             │    │
   │ │   +5 pts                        │    │
   │ └─────────────────────────────────┘    │
   │                                         │
   │ This rubric score is included in the    │
   │ final grade calculation                 │
   ├─────────────────────────────────────────┤
   │ Feedback                                │
   │ [Good thesis, but needs more____]       │
   │ [evidence to support claims.____]       │
   │                                         │
   │ ☑ Mark as Reviewed                      │
   └─────────────────────────────────────────┘
   ```

3. **Checkbox Rubric Grading**

   - Purple boxes for positive points
   - Red boxes for negative points (deductions)
   - Check/uncheck to award points
   - Score updates automatically

4. **Numerical Rubric Grading**
   ```
   ┌─────────────────────────────────────────┐
   │ Code Quality Rubric         7 / 20 pts  │
   ├─────────────────────────────────────────┤
   │ ┌─────────────────────────────────┐    │
   │ │ Code organization               │    │
   │ │ [3__] / 5 pts                   │    │
   │ └─────────────────────────────────┘    │
   │ ┌─────────────────────────────────┐    │
   │ │ Documentation                   │    │
   │ │ [4__] / 10 pts                  │    │
   │ └─────────────────────────────────┘    │
   │ ┌─────────────────────────────────┐    │
   │ │ Error handling                  │    │
   │ │ [0__] / 5 pts                   │    │
   │ └─────────────────────────────────┘    │
   └─────────────────────────────────────────┘
   ```

## Visual Design Specifications

### Colors

**Positive Criteria (Purple Theme):**

- Background: `bg-purple-50` (#F5F3FF)
- Border: `border-purple-200` (#DDD6FE)
- Text: `text-purple-700` (#7C3AED)
- Checkbox: `bg-purple-600` (#9333EA)

**Negative Criteria (Red Theme):**

- Background: `bg-red-50` (#FEF2F2)
- Border: `border-red-200` (#FECACA)
- Text: `text-red-700` (#B91C1C)
- Checkbox: `bg-red-600` (#DC2626)

**Neutral Elements:**

- Background: `bg-white` (#FFFFFF)
- Border: `border-gray-200` (#E5E7EB)
- Text: `text-gray-900` (#111827)

### Typography

- **Section Headers**: `text-sm font-bold text-gray-900`
- **Criterion Titles**: `text-sm font-medium text-gray-900`
- **Point Values**: `text-xs font-semibold` (purple or red)
- **Score Display**: `text-sm font-semibold text-purple-700`
- **Help Text**: `text-xs text-gray-600`

### Spacing

- Section padding: `p-4`
- Item spacing: `space-y-3`
- Border radius: `rounded-lg` (8px)
- Input height: `h-10`

### Icons

- **Add Criterion**: Plus icon (`<Plus />`)
- **Remove Criterion**: Trash icon (`<Trash2 />`)
- **Drag Handle**: Grip vertical icon (`<GripVertical />`)
- **Expand/Collapse**: Chevron icons (`<ChevronDown />`, `<ChevronRight />`)

## Interaction States

### Checkbox Rubric

- **Unchecked**: Empty checkbox, 0 points awarded
- **Checked**: Filled checkbox, full points awarded
- **Hover**: Slight opacity change
- **Disabled**: Grayed out, not interactive

### Numerical Rubric

- **Empty**: Shows 0
- **Focused**: Purple border highlight
- **Invalid**: Red border if exceeds max
- **Disabled**: Grayed out, not interactive

### Buttons

- **Primary**: Purple background, white text
- **Destructive**: Red background, white text
- **Ghost**: Transparent, gray text
- **Disabled**: Reduced opacity, not clickable

## Responsive Behavior

### Desktop (>768px)

- Full width panels
- Side-by-side score displays
- Comfortable spacing

### Tablet (768px - 1024px)

- Slightly reduced padding
- Maintained side-by-side layout
- Scrollable content areas

### Mobile (<768px)

- Stacked score displays
- Full-width inputs
- Touch-friendly targets (min 44px)
- Reduced padding

## Accessibility

### Keyboard Navigation

- Tab through all interactive elements
- Enter/Space to toggle checkboxes
- Arrow keys for number inputs
- Escape to close modals

### Screen Readers

- Proper ARIA labels on all inputs
- Role="switch" for checkboxes
- Descriptive button labels
- Status announcements for score updates

### Color Contrast

- All text meets WCAG AA standards
- Purple: 4.5:1 contrast ratio
- Red: 4.5:1 contrast ratio
- Focus indicators visible

## Error States

### Validation Errors

```
┌─────────────────────────────────────────┐
│ ⚠ Error saving rubric                   │
│ Each criterion must have a title and    │
│ point value                             │
└─────────────────────────────────────────┘
```

### Loading States

```
┌─────────────────────────────────────────┐
│ ⟳ Loading rubric...                     │
└─────────────────────────────────────────┘
```

### Empty States

```
┌─────────────────────────────────────────┐
│ No rubric configured                    │
│ [Create Rubric]                         │
└─────────────────────────────────────────┘
```

## Best Practices

### For Teachers Creating Rubrics

1. **Clear Criteria**: Use specific, measurable criteria
2. **Appropriate Points**: Align point values with importance
3. **Balanced Rubrics**: Mix of positive criteria and deductions
4. **Type Selection**:
   - Use checkbox for binary criteria
   - Use numerical for graduated assessment

### For Teachers Grading

1. **Consistency**: Apply rubric uniformly across students
2. **Feedback**: Add comments to explain rubric scores
3. **Review**: Mark as reviewed when grading is complete
4. **Modifiers**: Use score modifier for exceptional cases

### For Developers

1. **Validation**: Always validate rubric data on backend
2. **Auto-save**: Implement debounced auto-save for grading
3. **Error Handling**: Gracefully handle missing rubrics
4. **Performance**: Load rubrics efficiently with submissions
