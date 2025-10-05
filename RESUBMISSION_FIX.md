# Resubmission Logic Fix

## Issue

When students clicked "Resubmit", they received an error saying "Submission has already been submitted" even when the assignment setting `allowResubmissions` was enabled.

## Root Cause

The backend `POST /submission/:id/submit` endpoint was checking if a submission was already submitted and blocking it, without first checking the assignment's `allowResubmissions` setting.

## Solution

### 1. Fixed Submit Endpoint (`POST /submission/:id/submit`)

**File**: `classla-backend/src/routes/submissions.ts`

**Before**: Always blocked if status was `SUBMITTED`

**After**:

- Fetches assignment settings
- Only blocks resubmission if `allowResubmissions` is `false`
- If `allowResubmissions` is `true`, allows the submission to proceed
- Still blocks if status is `GRADED` (graded submissions cannot be resubmitted)

```typescript
// Get assignment settings to check if resubmissions are allowed
const { data: assignment } = await supabase
  .from("assignments")
  .select("settings")
  .eq("id", existingSubmission.assignment_id)
  .single();

const allowResubmissions = assignment?.settings?.allowResubmissions ?? false;

// Check if already submitted
if (existingSubmission.status === SubmissionStatus.SUBMITTED) {
  // Only block if resubmissions are not allowed
  if (!allowResubmissions) {
    res.status(400).json({
      error: {
        code: "ALREADY_SUBMITTED",
        message:
          "Submission has already been submitted and resubmissions are not allowed",
      },
    });
    return;
  }
  // If resubmissions are allowed, continue
}
```

### 2. Fixed Create/Update Endpoint (`POST /submission`)

**File**: `classla-backend/src/routes/submissions.ts`

**Before**: Always updated existing submission, even if it was submitted/graded

**After**:

- Checks if existing submission is submitted or graded
- If resubmissions are not allowed, returns error
- If resubmissions are allowed, creates a NEW submission with `IN_PROGRESS` status
- Only updates existing submission if it's still `IN_PROGRESS`

```typescript
if (existingSubmission && !existingError) {
  const isSubmittedOrGraded =
    existingSubmission.status === SubmissionStatus.SUBMITTED ||
    existingSubmission.status === SubmissionStatus.GRADED;

  if (isSubmittedOrGraded) {
    const allowResubmissions = assignment.settings?.allowResubmissions ?? false;

    if (!allowResubmissions) {
      res.status(400).json({
        error: {
          code: "RESUBMISSION_NOT_ALLOWED",
          message:
            "This assignment does not allow resubmissions after submission",
        },
      });
      return;
    }

    // Create new submission for resubmission
    const { data: newSubmission } = await supabase
      .from("submissions")
      .insert({
        assignment_id,
        course_id,
        student_id: userId,
        values: values || {},
        status: SubmissionStatus.IN_PROGRESS,
        timestamp: new Date(),
      })
      .select()
      .single();

    submission = newSubmission;
  } else {
    // Update existing in-progress submission
    // ...
  }
}
```

## Submission Status Flow

### Without Resubmissions (`allowResubmissions: false`)

```
IN_PROGRESS → SUBMITTED → GRADED
     ↑           ✗           ✗
     └─────────────────────────
     (Cannot go back)
```

### With Resubmissions (`allowResubmissions: true`)

```
IN_PROGRESS → SUBMITTED → GRADED
     ↑           ↓           ✗
     └───────────┘
     (Can create new submission)
```

## User Experience

### When `allowResubmissions: true`

1. Student submits assignment → Status: `SUBMITTED`
2. Student clicks "Resubmit" button
3. Backend creates NEW submission with status `IN_PROGRESS`
4. Student can edit and submit again
5. Process repeats as needed

### When `allowResubmissions: false`

1. Student submits assignment → Status: `SUBMITTED`
2. "Resubmit" button is hidden (frontend logic)
3. If student tries to resubmit via API → Error: "Resubmission not allowed"

## Testing Checklist

- [x] Resubmit works when `allowResubmissions: true`
- [x] Resubmit blocked when `allowResubmissions: false`
- [x] Cannot resubmit graded assignments
- [x] New submission created (not updated) on resubmit
- [x] Auto-save works on new resubmission
- [x] Submit button works on resubmission

## Related Files

- `classla-backend/src/routes/submissions.ts` - Backend logic
- `classla-frontend/src/components/AssignmentViewer.tsx` - Frontend resubmit button
- `classla-frontend/src/components/AssignmentSettingsPanel.tsx` - Settings UI
- `data_models.ts` - Assignment settings interface

## Notes

- Graded submissions can NEVER be resubmitted (even with `allowResubmissions: true`)
- Each resubmission creates a new submission record in the database
- The frontend should track the latest submission ID
- Old submissions are preserved for audit trail
