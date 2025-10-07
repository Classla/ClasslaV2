# Requirements Document

## Introduction

This feature enhances the grading system to automatically create grader objects and submissions when needed, and ensures all students are visible in the grading panel regardless of submission status. Currently, teachers can only see students who have submitted work, and grader objects must be manually created. This enhancement will streamline the grading workflow by showing all enrolled students with proper status indicators (Not Started, In Progress, Submitted) and automatically creating the necessary database records when teachers begin grading.

## Requirements

### Requirement 1: Display All Students in Grading Panel

**User Story:** As a teacher, I want to see all enrolled students in the grading panel regardless of submission status, so that I can track which students haven't started and grade students who haven't submitted.

#### Acceptance Criteria

1. WHEN a teacher opens the grading panel THEN the system SHALL display all students enrolled in the course
2. WHEN displaying students THEN each student SHALL show their current submission status
3. WHEN a student has not created a submission THEN their status SHALL display "Not Started" in red
4. WHEN a student has created a submission but not submitted it THEN their status SHALL display "In Progress" in yellow
5. WHEN a student has submitted their work THEN their status SHALL display "Submitted" in green
6. WHEN displaying students THEN the list SHALL be sorted by last name in ascending order
7. WHEN a teacher searches or filters students THEN all students SHALL remain in the filtered results regardless of submission status
8. WHEN a student has no submission THEN they SHALL still appear in the student list with appropriate status indicator

### Requirement 2: Backend Endpoint for All Students with Submissions

**User Story:** As a system, I want to provide an endpoint that returns all enrolled students with their submission data, so that the frontend can display complete student information.

#### Acceptance Criteria

1. WHEN the endpoint `/api/submissions/by-assignment/:assignmentId/with-students` is called THEN it SHALL return all students enrolled in the course
2. WHEN returning student data THEN each student SHALL include their enrollment information (name, section)
3. WHEN a student has submissions THEN their submission data SHALL be included
4. WHEN a student has no submissions THEN their submission field SHALL be null or empty array
5. WHEN a student has a grader object THEN it SHALL be included in the response
6. WHEN a student has no grader object THEN the grader field SHALL be null
7. WHEN the endpoint is called THEN only users with grading permissions SHALL be authorized
8. WHEN returning data THEN students SHALL be grouped by enrollment, not by submission

### Requirement 3: Auto-Create Grader Object on First Interaction

**User Story:** As a teacher, I want the system to automatically create a grader object when I start grading a student, so that I don't encounter errors and can grade seamlessly.

#### Acceptance Criteria

1. WHEN a teacher types in the score modifier field THEN the system SHALL create a grader object if one doesn't exist
2. WHEN a teacher types in the feedback textarea THEN the system SHALL create a grader object if one doesn't exist
3. WHEN a teacher checks the reviewed checkbox THEN the system SHALL create a grader object if one doesn't exist
4. WHEN creating a grader object THEN it SHALL be associated with the submission
5. WHEN creating a grader object THEN it SHALL initialize with default values (raw_assignment_score: 0, raw_rubric_score: 0, score_modifier: "", feedback: "")
6. WHEN a grader object is created THEN the creation SHALL happen before saving the user's input
7. WHEN grader creation fails THEN the system SHALL display an error message to the teacher
8. WHEN a grader object already exists THEN the system SHALL update it normally without creating a duplicate

### Requirement 4: Auto-Create Submission When Grading Student with No Submission

**User Story:** As a teacher, I want to be able to grade a student even if they haven't submitted anything, so that I can assign grades for non-submission or late work.

#### Acceptance Criteria

1. WHEN a teacher selects a student with no submission THEN the grading panel SHALL display the assignment viewer in read-only mode
2. WHEN a teacher enters grading information for a student with no submission THEN the system SHALL create a submission object
3. WHEN creating a submission for grading THEN it SHALL have status "not-started"
4. WHEN creating a submission for grading THEN it SHALL have empty content
5. WHEN creating a submission for grading THEN it SHALL be associated with the student and assignment
6. WHEN a submission is auto-created THEN a grader object SHALL also be created
7. WHEN displaying a student with no submission THEN the assignment viewer SHALL show empty/default content
8. WHEN a submission is auto-created THEN the teacher SHALL be able to continue grading without interruption

### Requirement 5: Backend Endpoint for Creating Grader with Submission

**User Story:** As a system, I want to provide an endpoint that creates both a submission and grader object atomically, so that data consistency is maintained.

#### Acceptance Criteria

1. WHEN the endpoint `/api/grader/create-with-submission` is called THEN it SHALL create both a submission and grader object
2. WHEN creating both objects THEN the operation SHALL be atomic (both succeed or both fail)
3. WHEN the submission already exists THEN the endpoint SHALL only create the grader object
4. WHEN both objects already exist THEN the endpoint SHALL return the existing grader
5. WHEN creating a submission THEN it SHALL use status "not-started"
6. WHEN creating a grader THEN it SHALL initialize with default scores
7. WHEN the operation fails THEN it SHALL return an appropriate error message
8. WHEN the endpoint is called THEN only users with grading permissions SHALL be authorized

### Requirement 6: Update GradingSidebar to Show All Students

**User Story:** As a teacher, I want the grading sidebar to show all students with proper status indicators, so that I have complete visibility of the class.

#### Acceptance Criteria

1. WHEN the GradingSidebar component loads THEN it SHALL fetch all enrolled students
2. WHEN displaying students THEN each SHALL show their name, status, and grade (if graded)
3. WHEN a student has no submission THEN their status SHALL be "Not Started"
4. WHEN a student has a submission with status "in-progress" THEN their status SHALL be "In Progress"
5. WHEN a student has a submission with status "submitted" THEN their status SHALL be "Submitted"
6. WHEN displaying status THEN "Not Started" SHALL be styled in red
7. WHEN displaying status THEN "In Progress" SHALL be styled in yellow
8. WHEN displaying status THEN "Submitted" SHALL be styled in green
9. WHEN a teacher clicks on a student with no submission THEN the grading view SHALL open with empty content

### Requirement 7: Update GradingControls to Auto-Create Grader

**User Story:** As a teacher, I want the grading controls to automatically create a grader object when I start typing, so that I don't encounter errors.

#### Acceptance Criteria

1. WHEN a teacher focuses on the score modifier input THEN the system SHALL check if a grader exists
2. WHEN a teacher focuses on the feedback textarea THEN the system SHALL check if a grader exists
3. WHEN no grader exists THEN the system SHALL create one before allowing input
4. WHEN creating a grader THEN it SHALL also create a submission if needed
5. WHEN grader creation is in progress THEN the input fields SHALL be disabled
6. WHEN grader creation succeeds THEN the input fields SHALL be enabled
7. WHEN grader creation fails THEN an error message SHALL be displayed
8. WHEN a grader already exists THEN no creation attempt SHALL be made

### Requirement 8: Handle Null Submission Case in AssignmentViewer

**User Story:** As a teacher, I want to view the assignment even when a student hasn't submitted, so that I can see what they were supposed to complete.

#### Acceptance Criteria

1. WHEN AssignmentViewer receives a null submission THEN it SHALL display the assignment content
2. WHEN displaying with null submission THEN all interactive elements SHALL be disabled
3. WHEN displaying with null submission THEN answer fields SHALL be empty
4. WHEN displaying with null submission THEN a message SHALL indicate "No submission yet"
5. WHEN a student later submits THEN the viewer SHALL update to show their work
6. WHEN displaying with null submission THEN the assignment structure SHALL be fully visible
7. WHEN displaying with null submission THEN no errors SHALL be thrown

### Requirement 9: Update Submission Status Logic

**User Story:** As a system, I want to correctly determine submission status based on data, so that teachers see accurate information.

#### Acceptance Criteria

1. WHEN a submission does not exist THEN the status SHALL be "Not Started"
2. WHEN a submission exists with status "in-progress" THEN the status SHALL be "In Progress"
3. WHEN a submission exists with status "submitted" THEN the status SHALL be "Submitted"
4. WHEN a submission exists with status "graded" THEN the status SHALL be "Submitted" (graded is a teacher action, not student status)
5. WHEN determining status THEN the logic SHALL handle null/undefined submissions gracefully
6. WHEN displaying status THEN the color coding SHALL be consistent across all components
7. WHEN a submission transitions from "not-started" to "in-progress" THEN the status display SHALL update automatically

### Requirement 10: Gradebook Integration

**User Story:** As a teacher, I want the gradebook to show all students including those who haven't submitted, so that I can see complete class performance.

#### Acceptance Criteria

1. WHEN viewing the gradebook THEN all enrolled students SHALL be displayed
2. WHEN a student has no submission THEN their cell SHALL display "Not Started" in red
3. WHEN a student has an in-progress submission THEN their cell SHALL display "In Progress" in yellow
4. WHEN a student has submitted but not been graded THEN their cell SHALL display "Submitted" in blue
5. WHEN a student has been graded THEN their cell SHALL display the grade
6. WHEN clicking on a "Not Started" cell THEN the grading panel SHALL open for that student
7. WHEN clicking on any cell THEN the teacher SHALL be able to grade the student
8. WHEN the gradebook loads THEN it SHALL fetch all students and their submission data efficiently
