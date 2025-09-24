# Implementation Plan

- [x] 1. Setup WorkOS backend dependencies and configuration

  - Install @workos-inc/node package and session management packages (express-session, connect-redis)
  - Configure environment variables for WorkOS AuthKit integration
  - Create WorkOS client initialization module with AuthKit configuration
  - _Requirements: 2.1, 2.2, 6.1_

- [x] 2. Implement WorkOS authentication service

  - [x] 2.1 Create WorkOS service class with OAuth methods

    - Write WorkOS service with login URL generation and callback handling
    - Implement user profile retrieval from WorkOS
    - Add error handling for WorkOS API calls
    - _Requirements: 2.1, 2.2, 7.1_

  - [x] 2.2 Create session management service
    - Implement session creation, validation, and destruction methods
    - Configure secure session storage with appropriate security settings
    - Add session cleanup and expiration handling
    - _Requirements: 2.2, 4.1, 6.1_

- [x] 3. Update backend authentication middleware

  - [x] 3.1 Replace Supabase token validation with session validation

    - Modify auth middleware to validate session cookies instead of JWT tokens
    - Update user context extraction to use session data
    - Remove Supabase client authentication code
    - _Requirements: 6.1, 6.2_

  - [x] 3.2 Implement user synchronization logic
    - Create service to sync WorkOS users with Supabase users table
    - Add automatic user creation when new users sign in
    - Update user data synchronization on profile changes
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [ ] 4. Create authentication API routes

  - [x] 4.1 Implement WorkOS login initiation endpoint

    - Create route to generate WorkOS authorization URL
    - Handle login request and redirect to WorkOS
    - Add proper error handling and validation
    - _Requirements: 2.1_

  - [x] 4.2 Implement WorkOS callback handler

    - Create callback route to handle WorkOS OAuth response
    - Exchange authorization code for user profile
    - Create user session and set secure cookies
    - _Requirements: 2.2, 2.3, 7.1_

  - [x] 4.3 Implement logout endpoint

    - Create route to destroy user sessions
    - Clear session cookies and cleanup session storage
    - Handle logout redirects appropriately
    - _Requirements: 4.1, 4.2_

  - [x] 4.4 Create user profile endpoint
    - Implement protected route to return current user information
    - Fetch user data from Supabase users table
    - Ensure proper session validation and error handling
    - _Requirements: 5.1, 5.2, 6.2_

- [x] 5. Update database schema for WorkOS integration

  - [x] 5.1 Add WorkOS user ID column to users table

    - Create migration to add workos_user_id column
    - Update user creation logic to store WorkOS ID
    - Add database constraints and indexes as needed
    - _Requirements: 7.4_

  - [x] 5.2 Update user-related database operations
    - Modify user queries to handle WorkOS user ID mapping
    - Update user creation and update procedures
    - Ensure backward compatibility with existing user records
    - _Requirements: 7.1, 7.2_

- [x] 6. Remove Supabase client dependencies from frontend

  - [x] 6.1 Remove Supabase client library and related code

    - Uninstall @supabase/supabase-js package
    - Delete supabase.ts client configuration file
    - Remove all Supabase client imports and usage
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 6.2 Update environment variables configuration
    - Remove Supabase URL and anon key from frontend environment
    - Add WorkOS client ID and API base URL configuration
    - Update environment example files
    - _Requirements: 1.1_

- [x] 7. Implement new frontend authentication service

  - [x] 7.1 Create WorkOS-based auth service

    - Implement auth service with login, logout, and session management
    - Add API client methods for authenticated requests
    - Handle authentication state and loading states
    - _Requirements: 2.1, 4.1, 5.3_

  - [x] 7.2 Update AuthContext to use new auth service
    - Replace Supabase auth logic with WorkOS auth service
    - Update context state management for session-based auth
    - Modify auth state change handling
    - _Requirements: 2.1, 4.1, 5.3_

- [x] 8. Create new authentication pages

  - [x] 8.1 Implement WorkOS login page

    - Create custom login form with email/password fields that sends credentials to backend API
    - Add loading states and error handling
    - Style login page with appropriate UI components
    - _Requirements: 2.1, 2.4_

  - [x] 8.2 Implement WorkOS signup page

    - Create custom signup form with required fields that sends data to backend API
    - Handle registration flow and success states
    - Add error handling for registration failures
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 8.3 Create authentication callback handler page

    - Implement callback page to handle WorkOS redirects
    - Process authentication results and handle errors
    - Redirect to dashboard on successful authentication
    - _Requirements: 2.2, 2.3_

  - [x] 8.4 Update dashboard to display user information
    - Modify dashboard to fetch and display user profile data
    - Show user information from the backend API
    - Add logout functionality to the dashboard
    - _Requirements: 5.1, 5.2, 4.1_

- [x] 9. Update API client for session-based authentication

  - [x] 9.1 Modify API client to use session cookies

    - Update axios configuration to include credentials
    - Remove authorization header logic for Supabase tokens
    - Add proper error handling for authentication failures
    - _Requirements: 1.2, 6.1, 6.2_

  - [x] 9.2 Update protected route components
    - Modify ProtectedRoute component to use new auth context
    - Update authentication checks and redirects
    - Ensure proper loading states during auth validation
    - _Requirements: 5.3, 6.1_

- [x] 10. Write comprehensive tests for authentication system

  - [x] 10.1 Create backend authentication tests

    - Write unit tests for WorkOS service methods
    - Test session management functionality
    - Create integration tests for auth middleware
    - _Requirements: 2.1, 2.2, 6.1, 6.2_

  - [x] 10.2 Create frontend authentication tests

    - Write tests for new auth service methods
    - Test AuthContext state management
    - Create tests for authentication page components
    - _Requirements: 2.1, 3.1, 4.1, 5.1_

  - [x] 10.3 Create end-to-end authentication tests
    - Test complete login and logout flows
    - Verify session persistence across page reloads
    - Test protected route access and redirects
    - _Requirements: 2.1, 2.2, 4.1, 5.3, 6.1_

- [x] 11. Update existing tests to work with new authentication

  - [x] 11.1 Update backend API route tests

    - Modify existing tests to use session-based authentication
    - Update test setup to create valid sessions
    - Fix any broken tests due to auth changes
    - _Requirements: 6.1, 6.2_

  - [x] 11.2 Update frontend component tests
    - Modify tests to use new AuthContext implementation
    - Update mocked authentication states
    - Fix component tests that depend on auth state
    - _Requirements: 5.1, 5.3_
