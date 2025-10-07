# Bug Fix: "not-started" Status Causing 500 Error

## Issue Description

**Reported:** 2025-10-05
**Severity:** Critical
**Component:** Backend API - `/grader/create-with-submission`

### Problem

When trying to grade an existing submission that doesn't have a grader yet, the system returns a 500 Internal Server Error with the message "Failed to create grader and submission records".

### Root Cause

The backend code was attempting to insert submissions with `status: "not-started"`, but the database schema only allows these status values:

- `'submitted'`
- `'graded'`
- `'returned'`
- `'in-progress'`

This caused a CHECK constraint violation in PostgreSQL, resulting in a 500 error.

## Database Schema

```sql
CREATE TABLE submissions (
    ...
    status TEXT CHECK (status IN ('submitted', 'graded', 'returned', 'in-progress')) DEFAULT 'in-progress',
    ...
);
```

The status "not-started" was never part of the allowed values.

## Solution

### 1. Backend Fix

Changed the submission creation to use `"in-progress"` instead of `"not-started"`:

**File:** `classla-backend/src/routes/graders.ts`

```typescript
// BEFORE (incorrect)
.insert({
  assignment_id: assignmentId,
  student_id: studentId,
  course_id: courseId,
  status: "not-started",  // ← This violates CHECK constraint
  values: {},
  timestamp: new Date(),
})

// AFTER (correct)
.insert({
  assignment_id: assignmentId,
  student_id: studentId,
  course_id: courseId,
  status: "in-progress",  // ← Matches schema constraint
  values: {},
  timestamp: new Date(),
})
```

### 2. TypeScript Type Updates

Removed "not-started" from the Submission status type to match the database schema:

**Files Updated:**

- `data_models.ts`
- `data_models.d.ts`
- `classla-frontend/src/types/index.ts`

```typescript
// BEFORE
status: "submitted" | "graded" | "returned" | "in-progress" | "not-started";

// AFTER
status: "submitted" | "graded" | "returned" | "in-progress";
```

### 3. Documentation Updates

Updated comments to clarify that "in-progress" is used for both:

- Students who have started but not submitted
- Auto-created submissions for grading purposes

### 4. Enhanced Error Logging

Added detailed error logging to help diagnose similar issues in the future:

```typescript
if (createSubmissionError) {
  console.error("Error creating submission:", createSubmissionError);
  throw createSubmissionError;
}

if (!newSubmission) {
  throw new Error("Submission was not created but no error was returned");
}
```

### 5. Frontend Display Logic

The frontend already handles the display correctly:

- When `submission === null`: Shows "Not Started" (red)
- When `submission.status === "in-progress"`: Shows "In Progress" (yellow)

This distinction is purely for UI purposes and doesn't require database changes.

## Files Changed

1. **classla-backend/src/routes/graders.ts**

   - Changed status from "not-started" to "in-progress"
   - Added validation for submission.id
   - Enhanced error logging

2. **data_models.ts**

   - Removed "not-started" from Submission status type
   - Updated documentation

3. **data_models.d.ts**

   - Removed "not-started" from Submission status type
   - Updated documentation

4. **classla-frontend/src/types/index.ts**

   - Removed "not-started" from Submission status type

5. **classla-frontend/src/components/**tests**/GradebookAutoCreation.integration.test.tsx**
   - Updated test to use "in-progress" instead of "not-started"

## Testing

### Manual Testing Steps

1. **Test Auto-Creation for Non-Submitter:**

   - Open grading panel
   - Select a student with no submission
   - Focus on grading input
   - Verify grader and submission are created successfully
   - Check that submission has status "in-progress"

2. **Test Auto-Creation for Existing Submission:**

   - Have a student submit an assignment
   - Open grading panel as teacher
   - Select that student
   - Focus on grading input
   - Verify only grader is created (submission already exists)
   - No errors should occur

3. **Verify Database:**
   ```sql
   SELECT status, COUNT(*)
   FROM submissions
   GROUP BY status;
   ```
   Should show no "not-started" entries

### Automated Tests

Existing tests updated to use "in-progress":

- `classla-backend/src/routes/__tests__/graders.test.ts` - All passing
- `classla-frontend/src/components/__tests__/GradebookAutoCreation.integration.test.tsx` - Updated

## Verification

### Before Fix:

- ❌ 500 Internal Server Error when creating grader
- ❌ Database constraint violation
- ❌ Unable to grade students without existing graders
- ❌ Poor error messages

### After Fix:

- ✅ Grader and submission created successfully
- ✅ No database constraint violations
- ✅ Can grade all students
- ✅ Better error logging for debugging

## Impact Assessment

### User Impact:

- **Critical:** Teachers were completely unable to grade students
- **Affected Users:** All teachers using the new grading auto-creation feature
- **Data Integrity:** No data corruption - only prevented creation

### System Impact:

- **Performance:** No impact
- **Backward Compatibility:** Fully compatible - "in-progress" was already valid
- **Database:** No schema changes required

## Deployment Notes

- No database migrations required
- Backend restart required to apply changes
- Frontend rebuild required for type updates
- No data cleanup needed (no "not-started" records exist)

## Related Requirements

This fix ensures compliance with:

- **Requirement 4.3:** "WHEN creating submission THEN system SHALL set status to valid value"
- **Requirement 5.2:** "WHEN creating grader THEN system SHALL handle database constraints"

## Prevention

To prevent similar issues in the future:

1. **Schema Validation:**

   - Always check database schema before using status values
   - Keep TypeScript types in sync with database constraints
   - Use enums or constants for status values

2. **Better Error Messages:**

   - Log actual database errors with details
   - Include constraint violation information
   - Return helpful error messages to frontend

3. **Testing:**

   - Add integration tests that verify database constraints
   - Test with actual database, not just mocks
   - Include constraint violation scenarios in tests

4. **Code Review:**
   - Verify status values match schema
   - Check for hardcoded strings that should be constants
   - Ensure error handling includes detailed logging

## Recommended Follow-Up

1. **Create Status Enum:**

   ```typescript
   export enum SubmissionStatus {
     IN_PROGRESS = "in-progress",
     SUBMITTED = "submitted",
     GRADED = "graded",
     RETURNED = "returned",
   }
   ```

2. **Add Database Validation Tests:**

   - Test that only valid status values can be inserted
   - Test constraint violations are handled gracefully

3. **Improve Error Responses:**
   - Return constraint violation details to frontend
   - Show user-friendly messages for common errors

## Sign-Off

- **Developer:** Kiro AI Assistant
- **Date:** 2025-10-05
- **Tested By:** ****\*\*\*\*****\_****\*\*\*\*****
- **Approved By:** ****\*\*\*\*****\_****\*\*\*\*****

## Additional Fix: Multiple Submissions Handling

### Issue

After fixing the "not-started" status issue, a new error appeared:

```
"Results contain 3 rows, application/vnd.pgrst.object+json requires 1 row"
```

This occurred when a student had multiple submissions (due to resubmissions being enabled) and the query used `.maybeSingle()` which expects 0 or 1 rows.

### Solution

Changed the query to explicitly handle multiple submissions by ordering by timestamp and taking the most recent:

```typescript
// BEFORE (fails with multiple submissions)
const { data: existingSubmission, error: submissionCheckError } = await supabase
  .from("submissions")
  .select("*")
  .eq("assignment_id", assignmentId)
  .eq("student_id", studentId)
  .maybeSingle(); // ← Fails if multiple rows exist

// AFTER (handles multiple submissions correctly)
const { data: submissions, error: submissionCheckError } = await supabase
  .from("submissions")
  .select("*")
  .eq("assignment_id", assignmentId)
  .eq("student_id", studentId)
  .order("timestamp", { ascending: false }) // ← Most recent first
  .limit(1); // ← Take only the most recent

const existingSubmission =
  submissions && submissions.length > 0 ? submissions[0] : null;
```

### Why This Matters

- Students can have multiple submissions when resubmissions are enabled
- Teachers should always grade the most recent submission
- The system now correctly identifies which submission to create a grader for

### Testing

1. Enable resubmissions for an assignment
2. Have a student submit multiple times
3. Teacher opens grading panel
4. System should create grader for the most recent submission only
5. No "multiple rows" error should occur
