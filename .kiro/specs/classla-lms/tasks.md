# Implementation Plan

- [x] 1. Set up project structure and core configuration

  - Create classla-backend directory with Express.js TypeScript setup
  - Create classla-frontend directory with Vite React TypeScript setup
  - Configure package.json files with necessary dependencies
  - Set up TypeScript configurations for both projects
  - _Requirements: 5.1, 5.2_

- [x] 2. Implement shared data models and types

  - Copy and organize TypeScript interfaces from data_models.ts into backend
  - Create shared type definitions for API requests and responses
  - Set up proper module exports for type sharing
  - _Requirements: 5.1_

- [x] 3. Set up Supabase database schema

  - Create SQL migration file with all table definitions
  - Implement user roles enum and all entity tables
  - Add proper indexes for performance optimization
  - Set up course_enrollments junction table for many-to-many relationships
  - _Requirements: 5.1, 2.1, 7.1_

- [x] 4. Implement backend core infrastructure
- [x] 4.1 Set up Express.js server with middleware stack

  - Create main server.ts file with Express configuration
  - Implement CORS, JSON parsing, and basic error handling middleware
  - Set up environment configuration for Supabase credentials
  - _Requirements: 5.2, 5.4_

- [x] 4.2 Implement Supabase client and authentication middleware

  - Set up Supabase client with server-side secret key
  - Create JWT token validation middleware for protected routes
  - Implement user context extraction from Supabase auth tokens
  - _Requirements: 1.5, 5.4_

- [x] 4.3 Create role-based authorization middleware

  - Implement permission checking logic for different user roles
  - Create course enrollment verification functions
  - Build authorization decorators for route protection
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 5. Implement user management routes
- [x] 5.1 Create user routes and handlers

  - Implement GET /user/:id endpoint with proper authorization
  - Create GET /users/:userId/courses endpoint for enrolled courses
  - Build GET /user/role/:courseId endpoint for role checking
  - Add PUT /user/:id endpoint for profile updates
  - _Requirements: 7.2, 7.3_

- [x] 5.2 Implement user enrollment functionality

  - Create POST /user/enroll endpoint for course enrollment
  - Implement enrollment validation and role assignment
  - Add database operations for course_enrollments table
  - _Requirements: 2.1, 7.1_

- [x] 6. Implement course management system
- [x] 6.1 Create course routes and CRUD operations

  - Implement GET /course/by-slug/:slug endpoint
  - Create GET /course/:id and batch retrieval endpoints
  - Build POST /course endpoint with instructor/admin authorization
  - Add PUT /course/:id and DELETE /course/:id with soft deletion
  - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 6.2 Implement section management routes

  - Create GET /sections/by-course/:courseId endpoint
  - Implement GET /section/by-slug/:slug and GET /section/:id endpoints
  - Build POST, PUT, DELETE endpoints for section management
  - Add composite slug validation for sections
  - _Requirements: 2.5_

- [x] 7. Implement assignment management system
- [x] 7.1 Create assignment routes with role-based content filtering

  - Implement GET /assignment/:id/student endpoint with filtered content
  - Create GET /assignment/:id endpoint for instructor view
  - Add content filtering logic to remove autograder data for students
  - _Requirements: 3.5, 7.2_

- [x] 7.2 Build assignment CRUD operations

  - Implement POST /assignment endpoint with rich content support
  - Create PUT /assignment/:id endpoint for updates
  - Add DELETE /assignment/:id endpoint with proper authorization
  - Implement assignment publishing to specific sections
  - _Requirements: 3.1, 3.2, 7.3_

- [x] 7.3 Implement assignment lockdown and due date features

  - Add due date mapping functionality per user
  - Implement lockdown mode with time restrictions
  - Create validation logic for lockdown time enforcement
  - _Requirements: 3.3, 3.4_

- [x] 8. Implement submission and grading system
- [x] 8.1 Create submission routes with privacy controls

  - Implement GET /submission/:id with student privacy checks
  - Create GET /submissions/by-assignment/:assignmentId endpoint
  - Add POST /submission endpoint for student submissions
  - Implement submission status tracking and updates
  - _Requirements: 4.1, 4.2, 7.2_

- [x] 8.2 Build grading functionality

  - Create PUT /submission/:id/grade endpoint for instructors
  - Implement grader feedback system with POST /grader endpoint
  - Add PUT /grader/:id endpoint for feedback updates
  - Link grader entries to submissions with proper authorization
  - _Requirements: 4.3, 4.4, 7.3_

- [x] 9. Implement rubric system
- [x] 9.1 Create rubric schema management

  - Implement POST /rubric-schema endpoint for creating templates
  - Create GET /rubric-schema/:assignmentId endpoint
  - Add rubric item management with points and titles
  - Implement use_for_grading flag functionality
  - _Requirements: 8.1, 8.4_

- [x] 9.2 Build rubric scoring system

  - Create POST /rubric endpoint for applying rubrics to submissions
  - Implement GET /rubric/:submissionId endpoint
  - Add PUT /rubric/:id endpoint for score updates
  - Integrate rubric scores with grade calculations
  - _Requirements: 8.2, 8.3, 8.5_

- [x] 10. Set up minimal frontend application
- [x] 10.1 Create React application structure

  - Set up Vite React TypeScript project
  - Configure React Router for client-side routing
  - Create basic layout component and routing structure
  - _Requirements: 6.4_

- [x] 10.2 Implement authentication flow

  - Create SignInPage component with Supabase Auth integration
  - Implement AuthProvider context for authentication state
  - Add ProtectedRoute component for route protection
  - Set up token storage and refresh handling
  - _Requirements: 1.1, 1.2, 6.1_

- [x] 10.3 Build dashboard and user settings

  - Create simple Dashboard component as landing page
  - Implement UserSettings component for profile management
  - Add basic navigation between sign-in, dashboard, and settings
  - Connect frontend to backend API for user data
  - _Requirements: 1.2, 6.2_

- [x] 11. Implement error handling and testing
- [x] 11.1 Add comprehensive error handling

  - Create centralized error handling middleware for backend
  - Implement structured error response format
  - Add frontend error boundary and API error handling
  - Set up logging for debugging and monitoring
  - _Requirements: 5.5, 6.5_

- [x] 11.2 Create basic test suite

  - Write unit tests for authentication and authorization middleware
  - Create integration tests for core API endpoints
  - Add tests for role-based access control logic
  - Implement database operation tests
  - _Requirements: 5.1, 7.5_

- [x] 12. Final integration and deployment preparation
  - Connect all backend routes to database operations
  - Verify end-to-end authentication flow between frontend and backend
  - Test role-based permissions across all endpoints
  - Ensure proper CORS configuration for frontend-backend communication
  - _Requirements: 1.5, 5.3, 5.4_
