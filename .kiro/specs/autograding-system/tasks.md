# Implementation Plan

- [x] 1. Create database migration for block_scores column

  - Create migration file `010_add_block_scores_to_graders.sql`
  - Add `block_scores` JSONB column to graders table
  - Add column comment explaining the JSON structure
  - Create GIN index on block_scores for future analytics
  - Test migration on development database
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8_

- [x] 2. Update data models for autograding

  - Update `Grader` interface to include `block_scores` field
  - Update `AssignmentSettings` interface to include `showScoreAfterSubmission` field
  - Add TypeScript types for autograding API request/response
  - Add `AutogradeResponse` interface with conditional fields
  - Add `BlockScore` interface for block-level scoring
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_

- [x] 3. Implement autograder backend route

  - [x] 3.1 Create autograder.ts route file

    - Set up Express router with authentication middleware
    - Define POST endpoint `/api/autograder/grade/:submissionId`
    - Implement authorization check function `canAutogradeSubmission`
    - Handle authorization for students (own submissions only)
    - Handle authorization for instructors/TAs (any submission in course)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_

  - [x] 3.2 Implement MCQ block extraction logic

    - Create `extractMCQBlocks` function to parse assignment content
    - Recursively traverse TipTap document structure
    - Extract MCQ blocks with id, options, points, and correct answers
    - Handle malformed JSON gracefully
    - Log warnings for invalid MCQ blocks
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8_

  - [x] 3.3 Implement score calculation logic

    - Create `calculateBlockScore` function for individual MCQ blocks
    - Compare student answers to correct answers
    - Award full points for exact match, zero for incorrect/partial
    - Handle missing or undefined student answers
    - Handle MCQ blocks with no correct answers defined
    - Create `calculateTotalPoints` function to sum all block points
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_

  - [x] 3.4 Implement core autograding function

    - Create `autogradeSubmission` function
    - Fetch submission and assignment from database
    - Extract MCQ blocks from assignment content
    - Calculate scores for each block
    - Build block_scores JSON object
    - Calculate total raw assignment score
    - Create or update grader object with scores
    - Update submission status to "graded"
    - Return grader object and total possible points
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [x] 3.5 Implement response formatting based on visibility

    - Check assignment `showScoreAfterSubmission` setting
    - If enabled and requester is student, return full score data
    - If disabled and requester is student, return success without scores
    - If requester is instructor/TA, always return full score data
    - Format response with appropriate fields
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_

  - [x] 3.6 Add error handling
    - Handle submission not found (404)
    - Handle assignment not found (404)
    - Handle authorization failures (403)
    - Handle database errors (500)
    - Handle malformed assignment content gracefully
    - Log detailed error information
    - Return user-friendly error messages
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8_

- [x] 4. Integrate autograding with submission flow

  - Update `POST /submission/:id/submit` endpoint in submissions.ts
  - Trigger autograding asynchronously after submission is saved
  - Don't block submission response on autograding completion
  - Handle autograding errors without failing submission
  - Log autograding errors for debugging
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_

- [x] 5. Update frontend API client

  - Add `autogradeSubmission` method to API client
  - Define request/response types
  - Handle API errors appropriately
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

- [x] 6. Implement assignment points calculation

  - [x] 6.1 Create points calculation utility

    - Create `calculateAssignmentPoints` function
    - Parse assignment content JSON
    - Recursively traverse document to find MCQ blocks
    - Sum points from all MCQ blocks
    - Handle parsing errors gracefully
    - Return 0 for invalid content
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

  - [x] 6.2 Update assignment header display
    - Add points display to assignment header
    - Use memoized calculation to avoid re-parsing
    - Update when assignment content changes
    - Display "Total Points: X" in header
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

- [x] 7. Update assignment settings UI

  - Add "Show score after submission" checkbox to AssignmentSettingsPanel
  - Add descriptive text explaining the setting
  - Save setting to assignment.settings.showScoreAfterSubmission
  - Default to false (scores hidden)
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_

- [ ] 8. Update student submission view

  - [x] 8.1 Integrate autograding into submit flow

    - Call autograding API after submission succeeds
    - Handle autograding response
    - Display score if visibility is enabled
    - Display success message if visibility is disabled
    - Show loading indicator during autograding
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_

  - [x] 8.2 Add error handling for autograding
    - Show error toast if autograding fails
    - Submission still marked as submitted
    - Provide retry option if needed
    - Log errors for debugging
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8_

- [x] 9. Update grading interface to display block scores

  - Add block scores section to GradingControls component
  - Display each block's awarded and possible points
  - Show block ID or question preview
  - Display total raw assignment score
  - Format scores clearly for instructors
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8_

- [ ] 10. Add instructor override capability

  - Ensure score_modifier field works with autograded scores
  - Display raw autograded score separately from final grade
  - Calculate final grade as: raw_assignment_score + score_modifier
  - Preserve block_scores when instructor manually adjusts
  - Allow re-running autograding to recalculate raw scores
  - Preserve score_modifier when re-autograding
  - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8_

- [ ]\* 11. Write backend tests for autograding

  - Test autograding endpoint with correct answers
  - Test autograding endpoint with incorrect answers
  - Test autograding endpoint with no answers
  - Test authorization for students (own submissions only)
  - Test authorization for instructors (any submission)
  - Test with missing submission (404)
  - Test with missing assignment (404)
  - Test score calculation for single correct answer MCQ
  - Test score calculation for multiple correct answers MCQ
  - Test score calculation with no correct answers defined
  - Test MCQ block extraction from valid content
  - Test MCQ block extraction from malformed content
  - Test response formatting with visibility enabled
  - Test response formatting with visibility disabled
  - _Requirements: All requirements_

- [ ]\* 12. Write frontend tests for autograding

  - Test assignment points calculation with multiple MCQs
  - Test assignment points calculation with no MCQs
  - Test points update when MCQ added/removed
  - Test settings panel toggle for showScoreAfterSubmission
  - Test submission flow with score visibility enabled
  - Test submission flow with score visibility disabled
  - Test autograding error handling in UI
  - Test block scores display in grading interface
  - _Requirements: All requirements_

- [ ] 13. Integration testing and bug fixes
  - Test end-to-end autograding flow
  - Create assignment with MCQs
  - Student submits with correct answers
  - Verify scores calculated correctly
  - Verify grader object created with block_scores
  - Verify submission status updated to "graded"
  - Test authorization flows for students and instructors
  - Test score visibility settings
  - Test instructor override capability
  - Fix any bugs discovered during testing
  - _Requirements: All requirements_
