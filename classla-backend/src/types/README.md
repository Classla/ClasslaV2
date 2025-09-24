# Classla LMS Type System

This directory contains all shared TypeScript types, interfaces, and utilities for the Classla LMS backend.

## Structure

```
types/
├── index.ts          # Main export file - import everything from here
├── entities.ts       # Core data model interfaces
├── enums.ts         # Enumerations (UserRole, SubmissionStatus)
├── api.ts           # API request/response types
├── guards.ts        # Type guards and validation utilities
├── constants.ts     # Application constants
├── examples.ts      # Usage examples
└── __tests__/       # Type system tests
```

## Usage

### Basic Import

```typescript
import { UserRole, Course, CreateCourseRequest, ApiResponse } from "@/types";
```

### Core Entities

The following entities represent the main data models:

- `User` - System users with roles and permissions
- `Course` - Educational courses
- `Section` - Course sections for organization
- `Assignment` - Course assignments with rich content
- `Submission` - Student assignment submissions
- `Grader` - Grading feedback and scores
- `Rubric` - Rubric instances for submissions
- `RubricSchema` - Rubric templates
- `CourseEnrollment` - User-course relationships

### API Types

All API endpoints use structured request/response types:

- `CreateXRequest` - Request body for creating resources
- `UpdateXRequest` - Request body for updating resources
- `XResponse` - Response format for resources
- `ApiResponse<T>` - Generic wrapper for all API responses
- `ErrorResponse` - Standardized error format

### Type Guards

Use type guards for runtime validation:

```typescript
import { isUserRole, isValidUUID, validateRequiredFields } from "@/types";

// Validate enum values
if (isUserRole(userInput)) {
  // userInput is now typed as UserRole
}

// Validate UUIDs
if (isValidUUID(id)) {
  // id is a valid UUID format
}

// Validate required fields
const { isValid, missingFields } = validateRequiredFields(requestBody, [
  "name",
  "email",
]);
```

### Constants

Use predefined constants for consistency:

```typescript
import { API_ROUTES, ERROR_CODES, HTTP_STATUS } from "@/types";

// Route definitions
app.get(API_ROUTES.COURSES, handler);

// Error handling
throw new Error(ERROR_CODES.UNAUTHORIZED);

// HTTP responses
res.status(HTTP_STATUS.CREATED).json(response);
```

## Best Practices

1. **Always use the main index export**: Import from `@/types` rather than individual files
2. **Use type guards for runtime validation**: Validate user input with the provided type guards
3. **Leverage the validation helpers**: Use `validateRequiredFields` for consistent validation
4. **Follow the API response format**: Always wrap responses in `ApiResponse<T>`
5. **Use constants**: Prefer predefined constants over magic strings/numbers

## Testing

The type system includes comprehensive tests in `__tests__/types.test.ts`. Run them with:

```bash
npm test -- --testPathPattern=types
```

## Examples

See `examples.ts` for practical usage examples of all major types and utilities.
