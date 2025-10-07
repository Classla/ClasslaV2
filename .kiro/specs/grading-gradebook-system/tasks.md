# Implementation Plan

- [x] 1. Strengthen backend submission authorization

  - Add explicit role checks to prevent students from accessing other students' submissions
  - Enhance `canAccessSubmission` function with detailed permission checks
  - Add authorization tests for submission endpoints
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [x] 2. Create new backend API endpoints for grading

  - [x] 2.1 Implement GET /api/submissions/by-assignment/:assignmentId/with-students endpoint

    - Fetch submissions with student information and grader data
    - Include section information for filtering
    - Require canGrade or canManage permission
    - _Requirements: 1.2, 1.5, 2.2, 2.4, 2.6_

  - [x] 2.2 Implement GET /api/courses/:courseId/gradebook endpoint

    - Fetch all students, assignments, submissions, and graders for a course
    - Optimize with JOINs to minimize queries
    - Require canGrade or canManage permission
    - _Requirements: 3.1, 3.2, 3.3, 3.8, 2.2, 2.4, 2.6_

  - [x] 2.3 Implement GET /api/courses/:courseId/grades/student endpoint

    - Fetch student's own assignments, submissions, and grader feedback
    - Filter to only published assignments
    - Require course enrollment
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_

  - [x] 2.4 Implement PUT /api/grader/:id/auto-save endpoint
    - Accept partial grader updates
    - Handle concurrent updates gracefully
    - Update reviewed_at timestamp appropriately
    - _Requirements: 1.10, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10_

- [x] 3. Create GradingControls component

  - [x] 3.1 Build component structure with all input fields

    - Autograded score display (read-only)
    - Raw score display (read-only)
    - Score modifier input (number)
    - Final grade display (calculated)
    - Feedback textarea
    - Reviewed checkbox
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

  - [x] 3.2 Implement grade calculation logic

    - Calculate final grade from raw scores and modifier
    - Display calculated grade in real-time
    - _Requirements: 8.9_

  - [x] 3.3 Implement auto-save functionality
    - Debounce input changes (500ms)
    - Call auto-save endpoint
    - Show saving indicator
    - Handle errors with toast notifications
    - _Requirements: 1.10, 8.8, 8.10_

- [x] 4. Create StudentList component

  - [x] 4.1 Build student list item display

    - Show student name in "Last, First" format
    - Display submission status badge
    - Display grade if graded
    - Display "Reviewed" badge if reviewed
    - Highlight selected student
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [x] 4.2 Implement search functionality

    - Add search input at top of list
    - Filter students by first or last name
    - Update filtered list on input change
    - _Requirements: 1.4_

  - [x] 4.3 Implement section filter

    - Add section dropdown filter
    - Fetch sections for the course
    - Filter students by selected section
    - _Requirements: 1.5_

  - [x] 4.4 Implement student sorting
    - Sort students by last name alphabetically
    - Maintain sort order after filtering
    - _Requirements: 1.3_

- [x] 5. Create StudentSubmissionView component

  - [x] 5.1 Build navigation header

    - Display student name prominently
    - Add previous/next arrow buttons
    - Disable arrows at list boundaries
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 5.2 Implement submission selector

    - Show dropdown when student has multiple submissions
    - Display submission timestamps
    - Update viewer when submission changes
    - Hide selector when only one submission exists
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [x] 5.3 Integrate AssignmentViewer component

    - Pass selected submission to viewer
    - Display student's work in read-only mode
    - Handle loading and error states
    - _Requirements: 1.6_

  - [x] 5.4 Integrate GradingControls component

    - Position below assignment viewer
    - Pass submission and grader data
    - Handle grader updates
    - _Requirements: 1.7, 1.8_

  - [x] 5.5 Implement auto-save before navigation
    - Save pending changes before switching students
    - Show saving indicator during navigation
    - Handle save errors gracefully
    - _Requirements: 6.7_

- [x] 6. Create GradingPanel component

  - [x] 6.1 Build panel layout and structure

    - Create panel container with close button
    - Add two-column layout (list + submission view)
    - Handle responsive behavior
    - _Requirements: 1.1_

  - [x] 6.2 Implement data fetching

    - Fetch submissions with student info on mount
    - Fetch grader data for submissions
    - Handle loading states with skeleton
    - Handle errors with error messages
    - _Requirements: 1.2_

  - [x] 6.3 Implement student selection logic

    - Track selected student in state
    - Update URL with selected student ID
    - Handle student selection from list
    - Handle navigation between students
    - _Requirements: 1.6, 1.8, 6.1, 6.2, 6.3_

  - [x] 6.4 Integrate StudentList component

    - Pass filtered students to list
    - Handle student selection callback
    - Pass search and filter state
    - _Requirements: 1.2, 1.3, 1.4, 1.5_

  - [x] 6.5 Integrate StudentSubmissionView component
    - Show when student is selected
    - Pass student and submission data
    - Handle navigation callbacks
    - Handle grader update callbacks
    - _Requirements: 1.6, 1.7, 1.8, 1.9, 1.10_

- [x] 7. Integrate GradingPanel into AssignmentPage

  - Replace placeholder grader panel content with GradingPanel component
  - Pass assignment and course data as props
  - Handle panel open/close state
  - Test integration with existing assignment page features
  - _Requirements: 1.1_

- [x] 8. Create GradebookTable component

  - [x] 8.1 Build table structure

    - Create fixed first column for student names
    - Create scrollable columns for assignments
    - Add header row with assignment names and points
    - Style table with borders and spacing
    - _Requirements: 3.1, 3.2, 3.3, 3.9_

  - [x] 8.2 Implement cell rendering logic

    - Display "Not Started" in red for unstarted assignments
    - Display "Submitted" for submitted but ungraded
    - Display grade fraction (e.g., "6/6") for graded
    - Handle missing data gracefully
    - _Requirements: 3.4, 3.5, 3.6_

  - [x] 8.3 Implement cell click handling
    - Navigate to assignment page with grading panel open
    - Pass student ID to pre-select student
    - _Requirements: 3.7_

- [x] 9. Create GradebookPage component

  - [x] 9.1 Build page layout and structure

    - Add page header with title
    - Add section filter dropdown
    - Add loading and error states
    - _Requirements: 3.1, 3.8_

  - [x] 9.2 Implement data fetching

    - Fetch gradebook data from new endpoint
    - Parse and organize data for table
    - Handle loading states
    - Handle errors with error messages
    - _Requirements: 3.1_

  - [x] 9.3 Implement section filtering

    - Filter students by selected section
    - Update table when filter changes
    - _Requirements: 3.8_

  - [x] 9.4 Integrate GradebookTable component
    - Pass students, assignments, and grade data
    - Handle cell click navigation
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 10. Add gradebook route and navigation

  - Add route `/course/:courseSlug/gradebook` to App.tsx
  - Add "Gradebook" link to course navigation menu
  - Restrict access to teachers, TAs, and admins
  - _Requirements: 3.1_

- [x] 11. Create GradeItem component

  - [x] 11.1 Build grade item display

    - Show assignment name
    - Show due date if available
    - Show grade status or score
    - Show "Graded" badge if graded
    - _Requirements: 4.2, 4.3, 4.4, 4.5_

  - [x] 11.2 Implement click handling
    - Navigate to assignment page on click
    - _Requirements: 4.6_

- [x] 12. Create StudentGradesPage component

  - [x] 12.1 Build page layout and structure

    - Add page header with title
    - Add loading and error states
    - Add empty state for no assignments
    - _Requirements: 4.1, 4.7_

  - [x] 12.2 Implement data fetching

    - Fetch student grades from new endpoint
    - Parse assignments, submissions, and graders
    - Handle loading states
    - Handle errors with error messages
    - _Requirements: 4.1_

  - [x] 12.3 Implement grade list rendering

    - Map assignments to GradeItem components
    - Sort by due date or assignment order
    - Show most recent submission for each assignment
    - _Requirements: 4.1, 4.2, 4.8_

  - [x] 12.4 Integrate GradeItem component
    - Pass assignment and grade data
    - Handle click navigation
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.6_

- [x] 13. Add student grades route and navigation

  - Add route `/course/:courseSlug/grades` to App.tsx
  - Add "Grades" link to course navigation menu for students
  - Restrict access to enrolled students
  - _Requirements: 4.1_

- [x] 14. Add API client methods

  - Add `getSubmissionsWithStudents(assignmentId)` method
  - Add `getCourseGradebook(courseId)` method
  - Add `getStudentGrades(courseId)` method
  - Add `autoSaveGrader(graderId, updates)` method
  - Add proper TypeScript types for responses
  - _Requirements: 1.2, 3.1, 4.1, 1.10_

- [x] 15. Update TypeScript types

  - Add `StudentSubmissionInfo` interface
  - Add `StudentGradebookInfo` interface
  - Add `GradebookData` interface
  - Add `StudentGradesData` interface
  - Add `SubmissionWithStudent` interface
  - Export types from types file
  - _Requirements: All_

- [x] 16. Add database indexes for performance

  - Add index on `submissions.assignment_id`
  - Add index on `submissions.student_id`
  - Add index on `submissions.course_id`
  - Add index on `graders.submission_id`
  - Create migration file for indexes
  - _Requirements: All (Performance)_

- [x] 17. Style components with Tailwind CSS

  - Style GradingPanel with consistent spacing and colors
  - Style StudentList with hover states and selection highlight
  - Style GradingControls with form styling
  - Style GradebookTable with fixed columns and scroll
  - Style StudentGradesPage with card layout
  - Ensure responsive design for all components
  - Match existing design system and color scheme
  - _Requirements: All (UI/UX)_

- [x] 18. Add loading and error states

  - Add skeleton loaders for data fetching
  - Add error messages with retry buttons
  - Add empty states for no data
  - Add loading spinners for actions
  - Add toast notifications for save success/failure
  - _Requirements: All (Error Handling)_

- [x] 19. Implement frontend caching and optimization

  - Add React Query or SWR for data caching
  - Memoize filtered and sorted lists
  - Debounce search input (300ms)
  - Debounce auto-save (500ms)
  - Optimize re-renders with React.memo
  - _Requirements: All (Performance)_

- [ ]\* 20. Write component tests

  - [ ]\* 20.1 Write tests for GradingControls

    - Test input handling
    - Test grade calculation
    - Test auto-save functionality
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10_

  - [ ]\* 20.2 Write tests for StudentList

    - Test search filtering
    - Test section filtering
    - Test sorting
    - Test student selection
    - _Requirements: 1.3, 1.4, 1.5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [ ]\* 20.3 Write tests for StudentSubmissionView

    - Test navigation
    - Test submission selector
    - Test component integration
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [ ]\* 20.4 Write tests for GradingPanel

    - Test data fetching
    - Test student selection
    - Test filtering and search
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10_

  - [ ]\* 20.5 Write tests for GradebookTable

    - Test cell rendering
    - Test click handling
    - Test data display
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.9_

  - [ ]\* 20.6 Write tests for GradebookPage

    - Test data fetching
    - Test section filtering
    - Test component integration
    - _Requirements: 3.1, 3.8_

  - [ ]\* 20.7 Write tests for StudentGradesPage
    - Test data fetching
    - Test grade display
    - Test navigation
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_

- [ ]\* 21. Write backend tests

  - [ ]\* 21.1 Write authorization tests

    - Test student cannot access other students' submissions
    - Test teacher can access all submissions in their course
    - Test teacher cannot access submissions in other courses
    - Test admin can access all submissions
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [ ]\* 21.2 Write endpoint tests

    - Test GET /api/submissions/by-assignment/:assignmentId/with-students
    - Test GET /api/courses/:courseId/gradebook
    - Test GET /api/courses/:courseId/grades/student
    - Test PUT /api/grader/:id/auto-save
    - _Requirements: 1.2, 3.1, 4.1, 1.10_

  - [ ]\* 21.3 Write permission tests
    - Test role-based access control
    - Test section-based filtering
    - Test cross-course access prevention
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [ ]\* 22. Write integration tests

  - [ ]\* 22.1 Test grading flow

    - Teacher opens grading panel
    - Selects student
    - Views submission
    - Enters grade and feedback
    - Navigates to next student
    - Verifies data persistence
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10_

  - [ ]\* 22.2 Test gradebook flow

    - Teacher opens gradebook
    - Filters by section
    - Clicks on grade cell
    - Navigates to grading panel
    - Returns to gradebook
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

  - [ ]\* 22.3 Test student grades flow
    - Student opens grades page
    - Views assignment list
    - Clicks on graded assignment
    - Views feedback and score
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_
