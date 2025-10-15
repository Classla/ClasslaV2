# Rubric System Updates

## Changes Made

### 1. Extra Credit Support

**Data Model Changes:**

- Added `isExtraCredit?: boolean` field to `RubricItem` interface
- Updated in: `data_models.ts`, `classla-frontend/src/types/index.ts`, `classla-backend/src/types/entities.ts`

**UI Changes:**

- Added "Extra Credit" checkbox in RubricEditor for positive point items
- Only shows for items with points > 0
- Blue theme for extra credit items (vs purple for normal, red for negative)
- Extra credit label shown in RubricGrading component

**Behavior:**

- Extra credit points are NOT counted towards total assignment points
- Extra credit points ARE added to student's final grade when awarded
- Allows students to exceed 100% on assignments

### 2. Total Assignment Points Calculation

**Updated `calculateAssignmentPoints` utility:**

- Now accepts optional `rubricSchema` parameter
- Calculates total from MCQ blocks + rubric points
- Only includes rubric items that are:
  - Positive points (> 0)
  - NOT marked as extra credit

**New `calculateRubricPoints` utility:**

- Calculates total points from rubric schema
- Filters out negative points and extra credit items
- Used by `calculateAssignmentPoints`

**AssignmentPage Integration:**

- Loads rubric schema on mount
- Passes rubric schema to `calculateAssignmentPoints`
- Total points display now includes rubric points
- Updates automatically when rubric changes

### 3. Raw Rubric Score Loading Fix

**Problem:** When loading a graded submission, the `raw_rubric_score` wasn't being displayed correctly in the grading panel.

**Solution:**

- Updated `GradingControls` component to calculate rubric score when loading existing rubric
- Compares calculated score with grader's `raw_rubric_score`
- Updates grader if scores don't match
- Ensures final grade calculation is correct on load

**Implementation:**

```typescript
// In GradingControls useEffect for loading rubric
if (grader && rubricData.values) {
  const rubricScore = rubricData.values.reduce(
    (sum: number, val: number) => sum + val,
    0
  );
  if (grader.raw_rubric_score !== rubricScore) {
    await onUpdate({ raw_rubric_score: rubricScore });
  }
}
```

### 4. Visual Design Updates

**Color Scheme:**

- **Purple**: Normal positive criteria
- **Blue**: Extra credit criteria
- **Red**: Negative criteria (deductions)

**RubricEditor:**

- Extra credit checkbox appears below points input
- Only visible for positive point values
- Blue checkbox to match extra credit theme

**RubricGrading:**

- Blue background for extra credit items
- "(Extra Credit)" label shown next to points
- Blue checkbox for extra credit items

### 5. Database Migration

**Updated `012_add_rubric_type.sql`:**

- Added comment explaining `items` JSONB structure
- Documents that items can have `isExtraCredit` boolean field
- No schema change needed (JSONB is flexible)

## Testing Checklist

### Extra Credit

- [ ] Create rubric with extra credit item
- [ ] Verify extra credit checkbox only shows for positive points
- [ ] Verify extra credit items are blue in grading panel
- [ ] Verify extra credit points NOT counted in total assignment points
- [ ] Verify extra credit points ARE added to student's final grade

### Total Points Calculation

- [ ] Create assignment with MCQ blocks only - verify total
- [ ] Add rubric with normal criteria - verify total increases
- [ ] Add extra credit criteria - verify total doesn't change
- [ ] Add negative criteria - verify total doesn't change
- [ ] Verify total shown in assignment header

### Raw Rubric Score Loading

- [ ] Grade a submission with rubric
- [ ] Reload the page
- [ ] Verify raw rubric score displays correctly
- [ ] Verify final grade is correct
- [ ] Change rubric values and verify updates

## Files Modified

### Frontend

- `classla-frontend/src/types/index.ts` - Added isExtraCredit to RubricItem
- `classla-frontend/src/components/RubricEditor.tsx` - Added extra credit checkbox
- `classla-frontend/src/components/RubricGrading.tsx` - Added extra credit styling
- `classla-frontend/src/components/GradingControls.tsx` - Fixed rubric score loading
- `classla-frontend/src/utils/assignmentPoints.ts` - Added rubric points calculation
- `classla-frontend/src/pages/AssignmentPage.tsx` - Load rubric schema, pass to calculation

### Backend

- `classla-backend/src/types/entities.ts` - Added isExtraCredit to RubricItem
- `classla-backend/migrations/012_add_rubric_type.sql` - Updated comments

### Root

- `data_models.ts` - Added isExtraCredit to RubricItem

### Documentation

- `RUBRIC_UPDATES.md` - This file

## Example Usage

### Creating a Rubric with Extra Credit

```typescript
{
  title: "Essay Grading Rubric",
  type: "checkbox",
  use_for_grading: true,
  items: [
    { title: "Clear thesis", points: 10, isExtraCredit: false },
    { title: "Supporting evidence", points: 10, isExtraCredit: false },
    { title: "Exceptional analysis", points: 5, isExtraCredit: true }, // Extra credit!
    { title: "Missing citations", points: -2, isExtraCredit: false }
  ]
}
```

**Total Assignment Points:** 20 (10 + 10, excluding extra credit and negative)
**Possible Student Score:** 0 to 25 (can exceed 100% with extra credit)

### Calculating Total Points

```typescript
// MCQ blocks: 30 points
// Rubric: 10 + 10 + 5 (extra) - 2 (negative) = 25 points
// Total assignment points: 30 + 20 = 50 points (excludes extra credit and negative)
// Student can score: 0 to 55 points (with extra credit)
```
