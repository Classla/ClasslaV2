# Rubric System Documentation

## Overview

The rubric system allows instructors to create structured grading criteria for assignments. Rubrics can be configured with multiple criteria, each with point values, and can be either checkbox-based (all-or-nothing) or numerical (scale-based).

## Features

### Rubric Types

1. **Checkbox Rubric (All-or-Nothing)**

   - Each criterion is either fully awarded or not awarded
   - Supports negative point values for deductions
   - Visual: Purple checkboxes for positive points, red checkboxes for negative points
   - Use case: Binary criteria like "Includes introduction" or "Code compiles"

2. **Numerical Rubric (Scale-Based)**
   - Each criterion can receive partial points on a scale from 0 to max points
   - Only supports non-negative point values
   - Visual: Numerical input fields with max point display
   - Use case: Graduated criteria like "Code quality (0-10 points)"

### Configuration

Instructors can configure rubrics from the Assignment Settings Panel:

1. **Rubric Title**: Name of the rubric (e.g., "Essay Grading Rubric")
2. **Rubric Type**: Choose between checkbox or numerical
3. **Use for Grading**: Toggle whether rubric score contributes to final grade
4. **Criteria**: Add multiple criteria with:
   - Title/description
   - Point value (can be negative for checkbox rubrics)

### Grading Workflow

When grading a student submission:

1. The rubric appears in the grading panel above the feedback box but below the scores
2. For checkbox rubrics: Check/uncheck boxes to award points
3. For numerical rubrics: Enter point values (0 to max) for each criterion
4. Rubric score automatically updates the `raw_rubric_score` in the grader
5. Final grade = `raw_assignment_score` + `raw_rubric_score` + `score_modifier`

## Data Model

### RubricSchema

```typescript
interface RubricSchema {
  id: string;
  assignment_id: string;
  title: string;
  type: RubricType; // "checkbox" or "numerical"
  use_for_grading: boolean;
  items: RubricItem[];
}
```

### RubricItem

```typescript
interface RubricItem {
  title: string;
  points: number; // Can be negative for checkbox rubrics
}
```

### Rubric (Instance)

```typescript
interface Rubric {
  id: string;
  submission_id: string;
  rubric_schema_id: string;
  values: number[]; // Scores for each rubric item
}
```

## API Endpoints

### Rubric Schema Management

- `GET /api/rubric-schema/:assignmentId` - Get rubric schema for assignment
- `POST /api/rubric-schema` - Create rubric schema (instructor only)
- `PUT /api/rubric-schema/:id` - Update rubric schema (instructor only)
- `DELETE /api/rubric-schema/:id` - Delete rubric schema (instructor only)

### Rubric Grading

- `GET /api/rubric/:submissionId` - Get rubric for submission
- `POST /api/rubric` - Create rubric instance (instructor/TA only)
- `PUT /api/rubric/:id` - Update rubric scores (instructor/TA only)
- `GET /api/rubric/:submissionId/score` - Get calculated rubric score

## UI Components

### RubricEditor

Location: `classla-frontend/src/components/RubricEditor.tsx`

Used in the Assignment Settings Panel to create and edit rubric schemas.

**Props:**

- `rubricSchema`: Existing schema or null for new
- `onSave`: Callback to save schema
- `onDelete`: Optional callback to delete schema

### RubricGrading

Location: `classla-frontend/src/components/RubricGrading.tsx`

Used in the Grading Controls to apply rubric scores to student submissions.

**Props:**

- `rubricSchema`: The rubric schema to use
- `rubric`: Existing rubric instance or null
- `onUpdate`: Callback when rubric values change
- `disabled`: Whether grading is disabled

## Visual Design

### Checkbox Rubric

- **Positive points**: Purple checkbox and background (`bg-purple-50`, `border-purple-200`)
- **Negative points**: Red checkbox and background (`bg-red-50`, `border-red-200`)
- Points display shows "+X pts" or "-X pts"

### Numerical Rubric

- Purple-themed input fields
- Shows "X / Y pts" format
- Input clamped between 0 and max points

### Score Display

- Total score shown as "X / Y pts" in purple
- Updates in real-time as criteria are checked/scored

## Database Migration

Migration file: `classla-backend/migrations/012_add_rubric_type.sql`

Adds `type` column to `rubric_schemas` table with:

- Type: VARCHAR(20)
- Default: 'checkbox'
- Constraint: CHECK (type IN ('checkbox', 'numerical'))

## Integration Points

### GradingControls Component

- Loads rubric schema for the assignment
- Loads rubric instance for the submission
- Displays RubricGrading component if rubric exists
- Updates `raw_rubric_score` when rubric values change

### AssignmentSettingsPanel Component

- Loads rubric schema for the assignment
- Displays RubricEditor in collapsible section
- Handles create/update/delete operations

### Grader Entity

- `raw_rubric_score`: Total points from rubric
- Combined with `raw_assignment_score` and `score_modifier` for final grade

## Future Enhancements

Potential improvements:

- Rubric templates library
- Import/export rubrics between assignments
- Rubric analytics (average scores per criterion)
- Student-facing rubric preview before submission
- Weighted criteria (different importance levels)
- Rubric comments per criterion
