# Requirements Document

## Introduction

This feature implements an automatic grading system for assignments with interactive MCQ blocks. Currently, when students submit assignments, grader objects are created manually without automatic score calculation. This enhancement will automatically calculate scores based on student answers to MCQ questions, store detailed per-block scoring information, and optionally display scores to students based on assignment settings. The system will ensure that the total points displayed in the assignment header matches the sum of points from all interactive blocks, and provide proper authorization so students can only trigger autograding on their own submissions while instructors can autograde any submission in their course.

## Requirements

### Requirement 1: Automatic Score Calculation for MCQ Blocks

**User Story:** As a system, I want to automatically calculate scores for MCQ blocks based on student answers, so that grading is accurate and consistent.

#### Acceptance Criteria

1. WHEN a submission is autograded THEN the system SHALL compare student answers to correct answers for each MCQ block
2. WHEN an MCQ answer is correct THEN the system SHALL award the full points for that block
3. WHEN an MCQ answer is incorrect THEN the system SHALL award zero points for that block
4. WHEN an MCQ block has multiple correct answers THEN the system SHALL only award points if all correct answers are selected
5. WHEN calculating the raw assignment score THEN the system SHALL sum all points awarded across all MCQ blocks
6. WHEN an MCQ block has no correct answer defined THEN the system SHALL award zero points
7. WHEN a student has not answered an MCQ block THEN the system SHALL award zero points for that block
8. WHEN calculating scores THEN the system SHALL handle missing or malformed answer data gracefully

### Requirement 2: Block-Level Score Storage in Grader Object

**User Story:** As a teacher, I want to see detailed scoring information for each question block, so that I can understand how students performed on individual questions.

#### Acceptance Criteria

1. WHEN a grader object is created by autograding THEN it SHALL store block-level scores in a JSON field
2. WHEN storing block scores THEN each entry SHALL include the block ID (UUID)
3. WHEN storing block scores THEN each entry SHALL include points awarded for that block
4. WHEN storing block scores THEN each entry SHALL include total possible points for that block
5. WHEN storing block scores THEN the format SHALL be `{ [blockId]: { awarded: number, possible: number } }`
6. WHEN the raw assignment score is calculated THEN it SHALL equal the sum of all awarded points from block scores
7. WHEN a block has no score data THEN it SHALL not be included in the block scores JSON
8. WHEN block scores are stored THEN they SHALL be queryable and displayable in the grading interface

### Requirement 3: Autograding API Endpoint

**User Story:** As a student, I want my assignment to be automatically graded when I submit it, so that I can receive immediate feedback on my performance.

#### Acceptance Criteria

1. WHEN the endpoint `POST /api/autograder/grade/:submissionId` is called THEN it SHALL autograde the specified submission
2. WHEN autograding THEN the system SHALL fetch the submission and its associated assignment
3. WHEN autograding THEN the system SHALL parse the assignment content to extract all MCQ blocks
4. WHEN autograding THEN the system SHALL compare student answers to correct answers for each block
5. WHEN autograding THEN the system SHALL create a grader object with calculated scores
6. WHEN a grader object already exists THEN the system SHALL update it with new autograded scores
7. WHEN autograding completes THEN the system SHALL update the submission status to "graded"
8. WHEN autograding fails THEN the system SHALL return an appropriate error message

### Requirement 4: Authorization for Autograding Endpoint

**User Story:** As a system administrator, I want to ensure students can only autograde their own submissions and instructors can autograde any submission in their course, so that data security is maintained.

#### Acceptance Criteria

1. WHEN a student calls the autograding endpoint THEN they SHALL only be authorized for their own submissions
2. WHEN a student attempts to autograde another student's submission THEN the system SHALL return 403 Forbidden
3. WHEN an instructor calls the autograding endpoint THEN they SHALL be authorized for any submission in their course
4. WHEN a teaching assistant calls the autograding endpoint THEN they SHALL be authorized for any submission in their course
5. WHEN a system admin calls the autograding endpoint THEN they SHALL be authorized for any submission
6. WHEN checking authorization THEN the system SHALL verify the submission belongs to the correct course
7. WHEN a user is not enrolled in the course THEN the system SHALL return 403 Forbidden
8. WHEN authorization fails THEN the system SHALL not perform any grading operations

### Requirement 5: Assignment Setting for Score Visibility

**User Story:** As a teacher, I want to control whether students can see their scores immediately after submission, so that I can choose when to release grades.

#### Acceptance Criteria

1. WHEN creating an assignment THEN the teacher SHALL be able to set a "showScoreAfterSubmission" setting
2. WHEN the setting is enabled THEN students SHALL see their score immediately after autograding
3. WHEN the setting is disabled THEN students SHALL not see score information after autograding
4. WHEN the setting is disabled THEN the autograding endpoint SHALL still create the grader object
5. WHEN the setting is disabled THEN the autograding endpoint SHALL return 200 status without score data
6. WHEN the setting is enabled THEN the autograding endpoint SHALL return the raw score and block scores
7. WHEN the setting is not specified THEN it SHALL default to false (scores hidden)
8. WHEN the setting changes THEN it SHALL not affect already-graded submissions

### Requirement 6: Autograding Response Based on Visibility Setting

**User Story:** As a student, I want to see my score immediately if the teacher allows it, so that I can gauge my performance.

#### Acceptance Criteria

1. WHEN autograding completes with visibility enabled THEN the response SHALL include raw_assignment_score
2. WHEN autograding completes with visibility enabled THEN the response SHALL include block_scores
3. WHEN autograding completes with visibility enabled THEN the response SHALL include total possible points
4. WHEN autograding completes with visibility disabled THEN the response SHALL only include success status
5. WHEN autograding completes with visibility disabled THEN the response SHALL not include any score information
6. WHEN an instructor calls the endpoint THEN the response SHALL always include score information regardless of setting
7. WHEN a teaching assistant calls the endpoint THEN the response SHALL always include score information regardless of setting
8. WHEN the response includes scores THEN it SHALL be formatted for easy display in the UI

### Requirement 7: Database Schema Update for Block Scores

**User Story:** As a developer, I want the grader table to store block-level scores, so that detailed grading information is persisted.

#### Acceptance Criteria

1. WHEN the migration runs THEN it SHALL add a "block_scores" column to the graders table
2. WHEN the column is added THEN it SHALL be of type JSONB
3. WHEN the column is added THEN it SHALL be nullable (for backwards compatibility)
4. WHEN the column is added THEN existing grader records SHALL have null block_scores
5. WHEN new grader objects are created by autograding THEN they SHALL populate the block_scores field
6. WHEN querying grader objects THEN the block_scores field SHALL be included in the response
7. WHEN the block_scores field is null THEN the system SHALL handle it gracefully
8. WHEN the migration is rolled back THEN the block_scores column SHALL be removed

### Requirement 8: Assignment Header Points Validation

**User Story:** As a teacher, I want the total points shown in the assignment header to match the sum of all MCQ block points, so that students see accurate point values.

#### Acceptance Criteria

1. WHEN an assignment is displayed THEN the header SHALL show the total possible points
2. WHEN calculating total points THEN the system SHALL sum all points from MCQ blocks in the assignment content
3. WHEN an assignment has no MCQ blocks THEN the total points SHALL be zero
4. WHEN an MCQ block is added THEN the total points SHALL update automatically
5. WHEN an MCQ block is removed THEN the total points SHALL update automatically
6. WHEN an MCQ block's points are changed THEN the total points SHALL update automatically
7. WHEN displaying the assignment THEN the header points SHALL always match the sum of block points
8. WHEN the assignment content is malformed THEN the system SHALL handle it gracefully and show zero points

### Requirement 9: Integration with Submission Flow

**User Story:** As a student, I want my assignment to be automatically graded when I submit it, so that the process is seamless.

#### Acceptance Criteria

1. WHEN a student submits an assignment THEN the system SHALL automatically call the autograding endpoint
2. WHEN autograding is triggered THEN it SHALL happen after the submission is saved
3. WHEN autograding fails THEN the submission SHALL still be marked as submitted
4. WHEN autograding succeeds THEN the submission status SHALL be updated to "graded"
5. WHEN autograding succeeds with visibility enabled THEN the student SHALL see their score
6. WHEN autograding succeeds with visibility disabled THEN the student SHALL see a success message without scores
7. WHEN the assignment has no MCQ blocks THEN autograding SHALL still create a grader with zero points
8. WHEN autograding is in progress THEN the UI SHALL show a loading indicator

### Requirement 10: MCQ Block Data Structure

**User Story:** As a developer, I want MCQ blocks to store correct answers and point values, so that autograding can function correctly.

#### Acceptance Criteria

1. WHEN an MCQ block is created THEN it SHALL store an array of correct answer IDs
2. WHEN an MCQ block is created THEN it SHALL store a point value (number)
3. WHEN an MCQ block has no correct answers marked THEN the correct answers array SHALL be empty
4. WHEN an MCQ block has multiple correct answers THEN all correct answer IDs SHALL be in the array
5. WHEN parsing MCQ blocks for autograding THEN the system SHALL extract the correct answers array
6. WHEN parsing MCQ blocks for autograding THEN the system SHALL extract the point value
7. WHEN an MCQ block is missing point value THEN it SHALL default to zero
8. WHEN an MCQ block data is malformed THEN the system SHALL skip that block and log a warning

### Requirement 11: Error Handling for Autograding

**User Story:** As a system, I want to handle autograding errors gracefully, so that failures don't break the submission process.

#### Acceptance Criteria

1. WHEN the submission is not found THEN the system SHALL return 404 Not Found
2. WHEN the assignment is not found THEN the system SHALL return 404 Not Found
3. WHEN the assignment content cannot be parsed THEN the system SHALL return 500 Internal Server Error
4. WHEN database operations fail THEN the system SHALL rollback transactions and return 500 Internal Server Error
5. WHEN authorization fails THEN the system SHALL return 403 Forbidden
6. WHEN an error occurs THEN the system SHALL log detailed error information
7. WHEN an error occurs THEN the system SHALL return a user-friendly error message
8. WHEN autograding fails THEN the submission SHALL remain in "submitted" status

### Requirement 12: Instructor Override Capability

**User Story:** As a teacher, I want to manually adjust autograded scores, so that I can account for partial credit or grading nuances.

#### Acceptance Criteria

1. WHEN viewing an autograded submission THEN the teacher SHALL see the raw autograded score
2. WHEN viewing an autograded submission THEN the teacher SHALL see block-level scores
3. WHEN a teacher modifies the score_modifier field THEN it SHALL adjust the final grade
4. WHEN a teacher modifies the feedback field THEN it SHALL be saved to the grader object
5. WHEN a teacher manually adjusts scores THEN the block_scores SHALL remain unchanged (showing original autograded values)
6. WHEN calculating final grade THEN it SHALL use: raw_assignment_score + score_modifier
7. WHEN a teacher re-runs autograding THEN it SHALL recalculate and overwrite the raw_assignment_score
8. WHEN a teacher re-runs autograding THEN it SHALL preserve the score_modifier value
