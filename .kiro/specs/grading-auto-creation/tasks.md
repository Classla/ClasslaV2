# Implementation Plan

- [x] 1. Enhance backend submissions endpoint to return all enrolled students

  - Modify `/api/submissions/by-assignment/:assignmentId/with-students` endpoint to fetch all course enrollments
  - Join enrollments with submissions and graders data
  - Return array where each entry represents an enrolled student (with null submission/grader if not present)
  - Ensure proper authorization checks (only graders can access)
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

- [x] 2. Create grader auto-creation endpoint

  - [x] 2.1 Implement `POST /api/grader/create-with-submission` endpoint

    - Accept assignmentId, studentId, and courseId in request body
    - Check if submission exists for student and assignment
    - Create submission with "not-started" status if missing
    - Check if grader exists for submission
    - Create grader with default values if missing
    - Return both submission and grader objects with creation flags
    - Wrap operations in database transaction for atomicity
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_

  - [ ]\* 2.2 Write backend tests for auto-creation endpoint
    - Test creates submission when missing
    - Test creates grader when missing
    - Test returns existing records without duplicating
    - Test transaction rollback on failure
    - Test authorization checks
    - Test with invalid IDs
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_

- [x] 3. Update GradingSidebar to display all students

  - [x] 3.1 Update student data processing logic

    - Remove filtering that excludes students without submissions
    - Handle null submission case in student list rendering
    - Implement status determination logic (Not Started, In Progress, Submitted)
    - Add color coding for status badges (red, yellow, green)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9_

  - [x] 3.2 Update student list item rendering
    - Display status badge with appropriate color
    - Show grade if grader exists
    - Handle click on student without submission
    - Ensure sorting and filtering work with all students
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9_

- [x] 4. Create useEnsureGrader hook for auto-creation

  - [x] 4.1 Implement custom hook

    - Accept assignmentId, studentId, courseId, and existing grader as parameters
    - Provide `ensureGrader` function that creates grader/submission if needed
    - Track creation state (isCreating)
    - Handle errors and return them to caller
    - Invalidate relevant queries after successful creation
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8_

  - [x] 4.2 Add API client method
    - Implement `createGraderWithSubmission` method in API client
    - Handle request/response types
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_

- [x] 5. Update GradingControls to use auto-creation

  - [x] 5.1 Integrate useEnsureGrader hook

    - Call hook with required parameters
    - Add onFocus handlers to score modifier and feedback inputs
    - Trigger ensureGrader on focus if grader doesn't exist
    - Disable inputs while creation is in progress
    - Show loading indicator during creation
    - Display error toast if creation fails
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8_

  - [x] 5.2 Update component props
    - Add assignmentId, studentId, and courseId props
    - Pass these props from parent components
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8_

- [x] 6. Update AssignmentViewer to handle null submissions

  - [x] 6.1 Modify component to accept null submission

    - Change submission prop type to `Submission | null`
    - Use empty content object when submission is null
    - Display "No submission yet" banner when submission is null
    - Disable all interactive elements when submission is null
    - Show assignment structure even without submission
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

  - [ ]\* 6.2 Write tests for null submission handling
    - Test renders without errors with null submission
    - Test displays warning message
    - Test shows assignment content
    - Test interactive elements are disabled
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

- [x] 7. Update AssignmentPage to pass required props

  - Update GradingSidebar usage to pass assignment, course, and student data
  - Update StudentSubmissionView to pass assignmentId, studentId, courseId to GradingControls
  - Ensure proper data flow from page to child components
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8_

- [x] 8. Update GradebookPage to show all students

  - [x] 8.1 Update gradebook data fetching

    - Ensure gradebook endpoint returns all enrolled students
    - Handle null submissions in gradebook table
    - Display "Not Started" status in cells for students without submissions
    - Apply color coding to status cells
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8_

  - [x] 8.2 Update GradebookTable cell rendering
    - Render "Not Started" in red for null submissions
    - Render "In Progress" in yellow for in-progress submissions
    - Render "Submitted" in blue for ungraded submissions
    - Render grade for graded submissions
    - Make all cells clickable to open grading panel
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8_

- [x] 9. Add status determination utility function

  - Create shared utility function for determining submission status
  - Export function for use across components (GradingSidebar, GradebookTable, etc.)
  - Include color coding logic
  - Handle all submission states and null case
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

- [x] 10. Update TypeScript types

  - Update API response types to reflect nullable submission/grader fields
  - Update component prop types
  - Add CreateGraderWithSubmissionRequest and Response types
  - Ensure type safety across all modified components
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_

- [x] 11. Integration testing and bug fixes
  - Test complete flow: open grading panel → see all students → select non-submitter → start grading → verify auto-creation
  - Test gradebook integration with all students
  - Test error scenarios and edge cases
  - Fix any bugs discovered during testing
  - Verify performance with large classes
  - _Requirements: All requirements_
