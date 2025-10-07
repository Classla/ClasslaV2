# Bug Fix: Instructors Appearing in Student List & Duplicate Students

## Issue Description

**Reported:** 2025-10-05
**Severity:** High
**Component:** Backend API - `/submissions/by-assignment/:assignmentId/with-students`

### Problem 1: Instructors Appearing in Student List

The "See all students" view in the grading panel was showing instructors and TAs in addition to students. This endpoint should only return users enrolled with the "student" role.

### Problem 2: Duplicate Students

If a student had multiple submissions for the same assignment (e.g., due to resubmissions), they would appear multiple times in the list.

## Root Cause

### Issue 1: Missing Role Filter

The query in `classla-backend/src/routes/submissions.ts` was fetching ALL course enrollments without filtering by role:

```typescript
// BEFORE (incorrect)
const { data: enrollments, error: enrollmentsError } = await supabase
  .from("course_enrollments")
  .select(...)
  .eq("course_id", assignment.course_id)
  .order("user(last_name)", { ascending: true });
```

This would return instructors, TAs, and students.

### Issue 2: No Deduplication Logic

The submission mapping logic didn't handle the case where a student has multiple submissions. It would simply overwrite the map entry, but the issue was that each submission could potentially create a separate entry if the data structure wasn't properly deduplicated.

## Solution

### Fix 1: Add Role Filter

Added `.eq("role", "student")` to the query to only fetch student enrollments:

```typescript
// AFTER (correct)
const { data: enrollments, error: enrollmentsError } = await supabase
  .from("course_enrollments")
  .select(...)
  .eq("course_id", assignment.course_id)
  .eq("role", "student")  // ← Added this line
  .order("user(last_name)", { ascending: true });
```

### Fix 2: Keep Most Recent Submission

Updated the submission mapping logic to explicitly keep only the most recent submission when a student has multiple:

```typescript
// BEFORE (could cause issues)
submissionsData?.forEach((submission: any) => {
  submissionMap.set(submission.student_id, {
    submission: { ... },
    grader: submission.grader?.[0] || null,
  });
});

// AFTER (correct)
submissionsData?.forEach((submission: any) => {
  const existingEntry = submissionMap.get(submission.student_id);

  // If no existing entry or this submission is more recent, use it
  if (!existingEntry || new Date(submission.timestamp) > new Date(existingEntry.submission.timestamp)) {
    submissionMap.set(submission.student_id, {
      submission: { ... },
      grader: submission.grader?.[0] || null,
    });
  }
});
```

## Files Changed

1. **classla-backend/src/routes/submissions.ts**

   - Line ~450: Added `.eq("role", "student")` filter
   - Lines ~470-485: Updated submission mapping logic to keep most recent

2. **classla-backend/src/routes/**tests**/grading-auto-creation.integration.test.ts**
   - Added test: "should only include students, not instructors or TAs"
   - Added test: "should show only most recent submission when student has multiple submissions"

## Testing

### Manual Testing Steps

1. **Test Instructor Filtering:**

   - Create a course with 3 students and 1 instructor
   - Create an assignment
   - Open grading panel
   - Verify only 3 students appear (not the instructor)

2. **Test Multiple Submissions:**
   - Have a student submit an assignment
   - Enable resubmissions in assignment settings
   - Have the same student submit again
   - Open grading panel
   - Verify student appears only once with their most recent submission

### Automated Tests

Two new integration tests were added:

```typescript
it("should only include students, not instructors or TAs", async () => {
  // Enrolls a teacher and verifies they don't appear in student list
});

it("should show only most recent submission when student has multiple submissions", async () => {
  // Creates multiple submissions and verifies only the newest is shown
});
```

## Verification

### Before Fix:

- ❌ Instructors appeared in grading sidebar
- ❌ Students with multiple submissions could appear multiple times
- ❌ Confusing UX for teachers

### After Fix:

- ✅ Only students appear in grading sidebar
- ✅ Each student appears exactly once
- ✅ Most recent submission is shown for students with resubmissions
- ✅ Clean, predictable UX

## Impact Assessment

### User Impact:

- **High:** Teachers were seeing incorrect data in grading panel
- **Affected Users:** All teachers using the grading feature
- **Data Integrity:** No data corruption, only display issue

### System Impact:

- **Performance:** Minimal - added one filter condition
- **Backward Compatibility:** Fully compatible - only filters results
- **Database:** No schema changes required

## Deployment Notes

- No database migrations required
- No configuration changes required
- Backend restart required to apply changes
- Frontend does not need changes (API contract unchanged)

## Related Requirements

This fix ensures compliance with:

- **Requirement 1.2:** "WHEN teacher opens grading panel THEN system SHALL display all enrolled students"
  - Now correctly interprets "students" as users with student role only
- **Requirement 2.2:** "WHEN fetching enrolled students THEN system SHALL return users with student role"
  - Explicitly filters by role
- **Requirement 2.8:** "WHEN multiple submissions exist for same student THEN system SHALL return only one entry per student"
  - Now explicitly handles this case

## Prevention

To prevent similar issues in the future:

1. **Code Review Checklist:**

   - Always verify role-based filtering when querying enrollments
   - Consider edge cases like multiple submissions
   - Test with mixed role enrollments

2. **Test Coverage:**

   - Add tests for role filtering in all enrollment queries
   - Add tests for deduplication logic
   - Include edge cases in integration tests

3. **Documentation:**
   - Document expected behavior for endpoints
   - Clarify "students" vs "enrollments" terminology
   - Add examples with multiple roles

## Sign-Off

- **Developer:** Kiro AI Assistant
- **Date:** 2025-10-05
- **Tested By:** ************\_************
- **Approved By:** ************\_************
