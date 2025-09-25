# Requirements Document

## Introduction

This feature adds interactive assignment editing and viewing capabilities to the Classla LMS. The system will provide two distinct components: an AssignmentEditor for instructors to create and edit assignments with interactive blocks, and an AssignmentViewer for students to view and interact with assignments. The initial implementation will focus on a Multiple Choice Question (MCQ) block that allows instructors to create questions with configurable answers and autograding, while students can select answers.

## Requirements

### Requirement 1

**User Story:** As an instructor, I want to edit assignment content using a rich text editor with interactive blocks, so that I can create engaging assignments with various question types.

#### Acceptance Criteria

1. WHEN an instructor opens an assignment THEN the system SHALL display the AssignmentEditor component
2. WHEN the instructor uses the editor THEN the system SHALL provide the same Notion-style interface as the CourseEditor
3. WHEN the instructor types "/" THEN the system SHALL show a slash command menu with available blocks including MCQ
4. WHEN the instructor saves content THEN the system SHALL store all block data within the assignment content
5. WHEN the instructor copies and pastes blocks THEN the system SHALL preserve all block data without external dependencies

### Requirement 2

**User Story:** As a student, I want to view assignment content in a read-only format with interactive elements, so that I can complete assignments and submit answers.

#### Acceptance Criteria

1. WHEN a student opens an assignment THEN the system SHALL display the AssignmentViewer component
2. WHEN the student views content THEN the system SHALL render all text and interactive blocks in read-only mode
3. WHEN the student encounters an MCQ block THEN the system SHALL allow answer selection but not editing
4. WHEN the student selects an answer THEN the system SHALL update the selection state
5. WHEN the student views the assignment THEN the system SHALL use the same content data as the editor

### Requirement 3

**User Story:** As an instructor, I want to create Multiple Choice Question blocks, so that I can add interactive questions to my assignments.

#### Acceptance Criteria

1. WHEN the instructor selects MCQ from the slash menu THEN the system SHALL insert a new MCQ block
2. WHEN the instructor edits an MCQ block THEN the system SHALL allow editing of question text and answer options
3. WHEN the instructor configures answers THEN the system SHALL allow marking one or more options as correct
4. WHEN the instructor sets up autograding THEN the system SHALL store grading configuration within the block
5. WHEN the instructor adds answer options THEN the system SHALL allow adding, removing, and reordering options

### Requirement 4

**User Story:** As a student, I want to interact with Multiple Choice Question blocks, so that I can answer questions in assignments.

#### Acceptance Criteria

1. WHEN a student views an MCQ block THEN the system SHALL display the question and answer options
2. WHEN the student clicks an answer option THEN the system SHALL select that option and deselect others
3. WHEN the student selects an answer THEN the system SHALL provide visual feedback for the selection
4. WHEN the student views the block THEN the system SHALL NOT show correct answers or grading information
5. WHEN the student interacts with the block THEN the system SHALL maintain selection state during the session

### Requirement 5

**User Story:** As an instructor, I want MCQ blocks to store all data internally, so that I can copy, paste, and move questions without losing configuration.

#### Acceptance Criteria

1. WHEN an MCQ block is created THEN the system SHALL store question text, options, correct answers, and grading config in the node
2. WHEN the instructor copies an MCQ block THEN the system SHALL include all block data in the copy operation
3. WHEN the instructor pastes an MCQ block THEN the system SHALL restore all original configuration
4. WHEN the assignment is saved THEN the system SHALL persist all MCQ data within the assignment content field
5. WHEN the assignment is loaded THEN the system SHALL restore all MCQ blocks with their complete configuration

### Requirement 6

**User Story:** As a system administrator, I want the assignment editor to integrate seamlessly with the existing assignment system, so that the feature works within the current architecture.

#### Acceptance Criteria

1. WHEN the system determines user role THEN the system SHALL show AssignmentEditor for instructors and AssignmentViewer for students
2. WHEN content is saved THEN the system SHALL use the existing assignment.content field
3. WHEN the assignment loads THEN the system SHALL use existing API endpoints for assignment data
4. WHEN the editor auto-saves THEN the system SHALL use the existing updateAssignment API method
5. WHEN the components render THEN the system SHALL maintain the existing assignment page layout and styling
