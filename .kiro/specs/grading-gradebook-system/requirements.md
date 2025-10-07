# Requirements Document

## Introduction

This feature adds comprehensive grading and gradebook functionality to the ClassLA LMS. Teachers need the ability to efficiently grade student submissions through a dedicated grading panel that displays student work alongside grading controls. Additionally, both teachers and students need a gradebook view to see grades across all assignments in a course. The grading panel will be integrated into the assignment page, while the gradebook will be a separate page accessible from the course navigation.

## Requirements

### Requirement 1: Grading Panel for Teachers

**User Story:** As a teacher, I want to grade student submissions one by one through a dedicated panel, so that I can efficiently review and provide feedback on student work.

#### Acceptance Criteria

1. WHEN a teacher opens an assignment THEN the grading panel SHALL be accessible via the existing "Grader Panel" button in the right sidebar
2. WHEN the grading panel is opened THEN it SHALL display a searchable, filterable list of students with submissions
3. WHEN viewing the student list THEN students SHALL be sorted by last name in ascending order by default
4. WHEN a teacher types in the search box THEN the list SHALL filter to show only students whose first or last names contain the search text
5. WHEN a teacher selects a section filter THEN the list SHALL show only students enrolled in that section
6. WHEN a student is selected from the list THEN the panel SHALL display the student's submission using the AssignmentViewer component
7. WHEN viewing a student's submission THEN the teacher SHALL see the grading controls including score modifier, feedback textarea, and reviewed checkbox
8. WHEN a teacher navigates between students THEN the system SHALL use previous/next arrow buttons to move through the filtered student list
9. WHEN a student has multiple submissions THEN the teacher SHALL be able to view previous submissions via a dropdown or navigation control
10. WHEN the teacher updates grading information THEN changes SHALL be saved to the grader table and submission table

### Requirement 2: Backend Authorization for Submissions

**User Story:** As a system administrator, I want to ensure that only authorized users can access submissions, so that student privacy is protected.

#### Acceptance Criteria

1. WHEN a student attempts to fetch a submission THEN the backend SHALL only allow access to their own submissions
2. WHEN a teacher, TA, or admin attempts to fetch a submission THEN the backend SHALL allow access to any submission in courses where they have grading permissions
3. WHEN an unauthorized user attempts to access a submission THEN the backend SHALL return a 403 Forbidden error
4. WHEN fetching submissions by assignment THEN the backend SHALL filter results based on the user's role and permissions
5. IF a user is a student THEN the backend SHALL only return their own submissions for that assignment
6. IF a user is a teacher, TA, or admin THEN the backend SHALL return all submissions for that assignment

### Requirement 3: Gradebook Table for Teachers

**User Story:** As a teacher, I want to view all student grades in a table format, so that I can see overall class performance at a glance.

#### Acceptance Criteria

1. WHEN a teacher navigates to the gradebook page THEN they SHALL see a table with students as rows and assignments as columns
2. WHEN viewing the gradebook THEN student names SHALL be displayed in the first column sorted by last name
3. WHEN viewing the gradebook THEN each assignment SHALL have a column showing the student's grade and total points
4. WHEN an assignment has not been started by a student THEN the cell SHALL display "Not Started" in red text
5. WHEN an assignment has been submitted but not graded THEN the cell SHALL display "Submitted" or the autograded score
6. WHEN an assignment has been graded THEN the cell SHALL display the final grade (e.g., "6/6")
7. WHEN a teacher clicks on a grade cell THEN they SHALL be navigated to the grading panel for that student and assignment
8. WHEN viewing the gradebook THEN the teacher SHALL be able to filter by section
9. WHEN viewing the gradebook THEN the table SHALL be horizontally scrollable to accommodate many assignments

### Requirement 4: Grades Panel for Students

**User Story:** As a student, I want to view my grades for all assignments, so that I can track my progress in the course.

#### Acceptance Criteria

1. WHEN a student navigates to the grades page THEN they SHALL see a list of all assignments in the course
2. WHEN viewing the grades list THEN each assignment SHALL display its name, due date, and grade status
3. WHEN an assignment has not been started THEN it SHALL show "Not Started" status
4. WHEN an assignment has been submitted but not graded THEN it SHALL show "Submitted" status with submission timestamp
5. WHEN an assignment has been graded THEN it SHALL show the final grade and any feedback provided
6. WHEN a student clicks on an assignment THEN they SHALL be navigated to the assignment viewer page
7. WHEN viewing graded assignments THEN the student SHALL see their score, feedback, and reviewed status
8. WHEN an assignment has multiple submissions THEN the student SHALL see the most recent submission's grade

### Requirement 5: Student List Display in Grading Panel

**User Story:** As a teacher, I want to see submission status and grades in the student list, so that I can quickly identify which students need grading.

#### Acceptance Criteria

1. WHEN viewing the student list in the grading panel THEN each student entry SHALL display their full name (Last, First format)
2. WHEN viewing the student list THEN each entry SHALL show the submission status (Submitted, In Progress, Not Started)
3. WHEN viewing the student list THEN each entry SHALL show the current grade if graded
4. WHEN a submission has been reviewed THEN the entry SHALL display a "Reviewed" badge in green
5. WHEN a submission has not been reviewed THEN the entry SHALL not display a reviewed badge
6. WHEN viewing the student list THEN entries SHALL be visually distinct with clear separation between students
7. WHEN a student is selected THEN their entry SHALL be highlighted in the list

### Requirement 6: Navigation Between Students in Grading Panel

**User Story:** As a teacher, I want to easily navigate between students while grading, so that I can efficiently grade all submissions.

#### Acceptance Criteria

1. WHEN viewing a student's submission in the grading panel THEN navigation arrows SHALL be displayed at the top
2. WHEN the teacher clicks the left arrow THEN the panel SHALL navigate to the previous student in the filtered list
3. WHEN the teacher clicks the right arrow THEN the panel SHALL navigate to the next student in the filtered list
4. WHEN viewing the first student in the list THEN the left arrow SHALL be disabled
5. WHEN viewing the last student in the list THEN the right arrow SHALL be disabled
6. WHEN navigating between students THEN the student's name SHALL be displayed prominently at the top
7. WHEN navigating between students THEN unsaved changes SHALL be saved automatically before navigation

### Requirement 7: Multiple Submission Viewing

**User Story:** As a teacher, I want to view a student's previous submissions, so that I can see their progress and grade the correct submission.

#### Acceptance Criteria

1. WHEN a student has multiple submissions THEN a submission selector SHALL be displayed in the grading panel
2. WHEN viewing the submission selector THEN it SHALL show all submissions with timestamps
3. WHEN the teacher selects a different submission THEN the viewer SHALL update to show that submission's content
4. WHEN viewing a previous submission THEN the grading controls SHALL still apply to the selected submission
5. WHEN a student has only one submission THEN the submission selector SHALL not be displayed
6. WHEN viewing submissions THEN the most recent submission SHALL be selected by default

### Requirement 8: Grading Controls and Feedback

**User Story:** As a teacher, I want to provide scores, modifiers, and feedback for student submissions, so that students receive comprehensive grading information.

#### Acceptance Criteria

1. WHEN viewing a submission in the grading panel THEN the teacher SHALL see the autograded score if available
2. WHEN viewing a submission THEN the teacher SHALL see a score modifier input field
3. WHEN viewing a submission THEN the teacher SHALL see a feedback textarea
4. WHEN viewing a submission THEN the teacher SHALL see a "Reviewed" checkbox
5. WHEN the teacher enters a score modifier THEN it SHALL accept positive or negative numbers
6. WHEN the teacher enters feedback THEN it SHALL support multi-line text
7. WHEN the teacher checks the "Reviewed" checkbox THEN the submission SHALL be marked as reviewed with a timestamp
8. WHEN grading information is updated THEN it SHALL be saved to the grader table
9. WHEN a final grade is calculated THEN it SHALL update the submission's grade field
10. WHEN the teacher navigates away THEN all changes SHALL be automatically saved
