# Manual Testing Checklist for Grading Auto-Creation Feature

## Prerequisites

- [ ] Backend server running on localhost:3001
- [ ] Frontend server running on localhost:5173
- [ ] Test database populated with:
  - At least one course
  - At least one published assignment
  - At least 5 enrolled students with different submission states:
    - 2 students with submitted work
    - 1 student with in-progress submission
    - 2 students with no submission

## Test 1: Grading Panel - Display All Students

### Steps:

1. [ ] Log in as a teacher
2. [ ] Navigate to a course
3. [ ] Open an assignment
4. [ ] Click "Grade" or open grading panel

### Expected Results:

- [ ] Grading sidebar displays on the right side
- [ ] All enrolled students are visible in the list
- [ ] Students are sorted by last name (ascending)
- [ ] Each student shows their name in "LastName, FirstName" format

### Status Badges:

- [ ] Students without submissions show "Not Started" badge in RED
- [ ] Students with in-progress submissions show "In Progress" badge in YELLOW
- [ ] Students with submitted work show "Submitted" badge in GREEN
- [ ] Students with graded work show "Submitted" badge in GREEN with grade displayed

## Test 2: Select Non-Submitter and View Assignment

### Steps:

1. [ ] From the grading panel, click on a student with "Not Started" status
2. [ ] Observe the assignment viewer area

### Expected Results:

- [ ] Assignment viewer displays the assignment content
- [ ] A yellow banner appears with message "This student has not submitted this assignment yet"
- [ ] Assignment structure is visible (questions, prompts, etc.)
- [ ] All answer fields are empty
- [ ] Interactive elements (if any) are disabled

## Test 3: Auto-Creation on First Interaction

### Steps:

1. [ ] With a non-submitter selected, locate the grading controls panel
2. [ ] Click on the "Score Modifier" input field (or focus it)
3. [ ] Observe the behavior

### Expected Results:

- [ ] A loading indicator appears with text "Initializing grading..."
- [ ] Input fields are disabled during loading
- [ ] Loading completes within 1-2 seconds
- [ ] Loading indicator disappears
- [ ] Input fields become enabled
- [ ] No error messages appear

### Verify in Browser DevTools (Network tab):

- [ ] POST request to `/api/grader/create-with-submission` was made
- [ ] Request body contains: `assignmentId`, `studentId`, `courseId`
- [ ] Response status is 200
- [ ] Response contains `submission` and `grader` objects
- [ ] Response shows `created.submission: true` and `created.grader: true`

## Test 4: Grade the Non-Submitter

### Steps:

1. [ ] After auto-creation completes, type "+5" in the Score Modifier field
2. [ ] Type "Needs improvement" in the Feedback textarea
3. [ ] Wait 2 seconds for auto-save

### Expected Results:

- [ ] Input is accepted without errors
- [ ] Auto-save indicator appears briefly
- [ ] Changes are saved successfully
- [ ] No error toasts appear

### Verify in Browser DevTools:

- [ ] PUT request to `/api/grader/{graderId}/auto-save` was made
- [ ] Request contains the updated values
- [ ] Response status is 200

## Test 5: Student with In-Progress Submission

### Steps:

1. [ ] Click on a student with "In Progress" status
2. [ ] Click on the Score Modifier input field

### Expected Results:

- [ ] Assignment viewer shows the student's partial work
- [ ] Loading indicator appears briefly
- [ ] Only grader is created (submission already exists)
- [ ] Input fields become enabled
- [ ] Can grade normally

### Verify in Browser DevTools:

- [ ] POST request to `/api/grader/create-with-submission` was made
- [ ] Response shows `created.submission: false` and `created.grader: true`

## Test 6: Student with Existing Grader

### Steps:

1. [ ] Click on a student with "Submitted" status who has been graded
2. [ ] Click on the Score Modifier input field

### Expected Results:

- [ ] No loading indicator appears
- [ ] Input fields are immediately enabled
- [ ] Existing grader data is displayed
- [ ] No API call to create-with-submission endpoint

### Verify in Browser DevTools:

- [ ] NO POST request to `/api/grader/create-with-submission`
- [ ] Existing grader data loaded from initial query

## Test 7: Error Handling

### Steps:

1. [ ] Open browser DevTools → Network tab
2. [ ] Set network throttling to "Offline"
3. [ ] Click on a non-submitter
4. [ ] Try to focus on Score Modifier input

### Expected Results:

- [ ] Loading indicator appears
- [ ] After timeout, error toast appears with message "Failed to initialize grading. Please try again."
- [ ] Input fields remain disabled
- [ ] Can retry by focusing again after restoring network

### Cleanup:

- [ ] Set network back to "Online"

## Test 8: Gradebook Integration

### Steps:

1. [ ] Navigate to the course gradebook page
2. [ ] Observe the gradebook table

### Expected Results:

- [ ] All enrolled students are displayed as rows
- [ ] All published assignments are displayed as columns
- [ ] Each cell shows appropriate content:
  - Grade value (e.g., "85") for graded submissions
  - "Submitted" in BLUE for ungraded submissions
  - "In Progress" in YELLOW for in-progress submissions
  - "Not Started" in RED for no submission
- [ ] All cells are clickable (cursor changes to pointer on hover)

## Test 9: Grade from Gradebook

### Steps:

1. [ ] In the gradebook, find a cell showing "Not Started"
2. [ ] Click on that cell
3. [ ] Grading panel should open

### Expected Results:

- [ ] Grading panel opens on the right side
- [ ] Correct student and assignment are selected
- [ ] Assignment viewer shows empty content with "no submission" banner
- [ ] Can focus on grading controls and trigger auto-creation
- [ ] Auto-creation works as expected (see Test 3)
- [ ] Can complete grading
- [ ] After saving, gradebook updates to show new grade

## Test 10: Search and Filter

### Steps:

1. [ ] In the grading sidebar, use the search box (if available)
2. [ ] Type a student's name

### Expected Results:

- [ ] Student list filters to show matching students
- [ ] Non-submitters remain in filtered results
- [ ] Status badges still display correctly

## Test 11: Performance with Large Class

### Setup:

- [ ] Use a course with 50+ students
- [ ] Mix of submission states

### Steps:

1. [ ] Open grading panel
2. [ ] Measure time to load student list
3. [ ] Click through several students
4. [ ] Trigger auto-creation for a non-submitter

### Expected Results:

- [ ] Student list loads in < 1 second
- [ ] Switching between students is smooth (< 500ms)
- [ ] Auto-creation completes in < 2 seconds
- [ ] No lag or freezing
- [ ] Scrolling is smooth

## Test 12: Concurrent Grading (Two Teachers)

### Setup:

- [ ] Open two browser windows (or use incognito mode)
- [ ] Log in as teacher in both windows
- [ ] Navigate to same assignment

### Steps:

1. [ ] In Window 1: Select a non-submitter and trigger auto-creation
2. [ ] In Window 2: Select the same non-submitter and trigger auto-creation
3. [ ] Both teachers grade the student

### Expected Results:

- [ ] Both auto-creation requests succeed
- [ ] No duplicate submissions or graders created
- [ ] Both teachers see the same grader object
- [ ] Last save wins (expected behavior)
- [ ] No errors or conflicts

### Verify in Database:

- [ ] Only one submission record exists for that student/assignment
- [ ] Only one grader record exists for that submission

## Test 13: Authorization

### Steps:

1. [ ] Log in as a student
2. [ ] Try to access grading panel URL directly
3. [ ] Try to access gradebook URL directly

### Expected Results:

- [ ] Student is redirected or sees "Access Denied" message
- [ ] Cannot access grading endpoints
- [ ] Cannot see other students' submissions

## Test 14: Edge Cases

### Test 14a: Assignment with No Enrolled Students

- [ ] Create assignment in course with no students
- [ ] Open grading panel
- [ ] Should show empty state message

### Test 14b: Student Unenrolled After Grading Started

- [ ] Start grading a student
- [ ] Have another admin unenroll that student
- [ ] Try to save grading
- [ ] Should show appropriate error message

### Test 14c: Assignment Deleted During Grading

- [ ] Start grading
- [ ] Have another admin delete the assignment
- [ ] Try to save grading
- [ ] Should show appropriate error message

## Test 15: Mobile Responsiveness (Optional)

### Steps:

1. [ ] Open grading panel on mobile device or use browser DevTools device emulation
2. [ ] Test all grading functionality

### Expected Results:

- [ ] Grading sidebar is accessible (may be collapsible)
- [ ] Can select students
- [ ] Can trigger auto-creation
- [ ] Can enter grading information
- [ ] Touch interactions work correctly

## Regression Testing

### Verify Existing Functionality Still Works:

- [ ] Creating assignments
- [ ] Publishing assignments
- [ ] Students submitting assignments
- [ ] Manual grader creation (if applicable)
- [ ] Gradebook calculations
- [ ] Grade exports
- [ ] Student grade view

## Sign-Off

### Tester Information:

- **Name:** ************\_\_\_************
- **Date:** ************\_\_\_************
- **Environment:** Development / Staging / Production
- **Browser:** Chrome / Firefox / Safari / Edge
- **Version:** ************\_\_\_************

### Overall Assessment:

- [ ] All critical tests passed
- [ ] All bugs documented
- [ ] Feature ready for production
- [ ] Feature needs additional work

### Notes:

---

---

---

---
