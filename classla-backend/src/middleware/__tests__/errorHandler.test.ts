import { Request, Response, NextFunction } from 'express';
import {
  CustomError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  DatabaseError,
  errorHandler,
  asyncHandler,
  notFoundHandler
} from '../errorHandler';

describe('Error Handler Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;

  beforeEach(() => {
    mockJson = jest.fn();
    mockStatus = jest.fn().mockReturnValue({ json: mockJson });
    
    mockRequest = {
      method: 'GET',
      originalUrl: '/test',
      headers: {}
    };
    
    mockResponse = {
      status: mockStatus,
      json: mockJson
    };
    
    mockNext = jest.fn();
    
    // Mock console methods
    jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Custom Error Classes', () => {
    it('should create CustomError with correct properties', () => {
      const error = new CustomError('Test error', 400, 'TEST_ERROR');
      
      expect(error.message).toBe('Test error');
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe('TEST_ERROR');
      expect(error.isOperational).toBe(true);
    });

    it('should create ValidationError with correct properties', () => {
      const error = new ValidationError('Invalid input');
      
      expect(error.message).toBe('Invalid input');
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe('VALIDATION_ERROR');
    });

    it('should create AuthenticationError with correct properties', () => {
      const error = new AuthenticationError();
      
      expect(error.message).toBe('Authentication required');
      expect(error.statusCode).toBe(401);
      expect(error.code).toBe('AUTHENTICATION_ERROR');
    });

    it('should create AuthorizationError with correct properties', () => {
      const error = new AuthorizationError();
      
      expect(error.message).toBe('Insufficient permissions');
      expect(error.statusCode).toBe(403);
      expect(error.code).toBe('AUTHORIZATION_ERROR');
    });

    it('should create NotFoundError with correct properties', () => {
      const error = new NotFoundError('User');
      
      expect(error.message).toBe('User not found');
      expect(error.statusCode).toBe(404);
      expect(error.code).toBe('NOT_FOUND');
    });

    it('should create ConflictError with correct properties', () => {
      const error = new ConflictError('Resource already exists');
      
      expect(error.message).toBe('Resource already exists');
      expect(error.statusCode).toBe(409);
      expect(error.code).toBe('CONFLICT_ERROR');
    });

    it('should create DatabaseError with correct properties', () => {
      const error = new DatabaseError();
      
      expect(error.message).toBe('Database operation failed');
      expect(error.statusCode).toBe(500);
      expect(error.code).toBe('DATABASE_ERROR');
    });
  });

  describe('errorHandler middleware', () => {
    it('should handle CustomError correctly', () => {
      const error = new CustomError('Test error', 400, 'TEST_ERROR');
      
      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);
      
      expect(mockStatus).toHaveBeenCalledWith(400);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'TEST_ERROR',
            message: 'Test error'
          }),
          timestamp: expect.any(String),
          path: '/test',
          requestId: expect.any(String)
        })
      );
    });

    it('should handle ValidationError correctly', () => {
      const error = new Error('Validation failed');
      error.name = 'ValidationError';
      
      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);
      
      expect(mockStatus).toHaveBeenCalledWith(400);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'VALIDATION_ERROR',
            message: 'Validation failed'
          })
        })
      );
    });

    it('should handle JWT errors correctly', () => {
      const error = new Error('Invalid token');
      error.name = 'JsonWebTokenError';
      
      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);
      
      expect(mockStatus).toHaveBeenCalledWith(401);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'INVALID_TOKEN',
            message: 'Invalid authentication token'
          })
        })
      );
    });

    it('should handle expired token errors correctly', () => {
      const error = new Error('Token expired');
      error.name = 'TokenExpiredError';
      
      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);
      
      expect(mockStatus).toHaveBeenCalledWith(401);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'TOKEN_EXPIRED',
            message: 'Authentication token has expired'
          })
        })
      );
    });

    it('should handle generic errors with 500 status', () => {
      const error = new Error('Something went wrong');
      
      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);
      
      expect(mockStatus).toHaveBeenCalledWith(500);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Something went wrong'
          })
        })
      );
    });

    it('should include user ID in logs when available', () => {
      const error = new CustomError('Test error', 400);
      mockRequest.user = { id: 'user-123' };
      
      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);
      
      // Verify that the response was sent with correct status
      expect(mockStatus).toHaveBeenCalledWith(400);
      expect(mockJson).toHaveBeenCalled();
    });

    it('should mask error details in production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      
      const error = new Error('Internal database error');
      
      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);
      
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          error: {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Internal server error'
          }
        })
      );
      
      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('asyncHandler wrapper', () => {
    it('should call next with error when async function throws', async () => {
      const asyncFunction = async () => {
        throw new Error('Async error');
      };
      
      const wrappedFunction = asyncHandler(asyncFunction);
      await wrappedFunction(mockRequest as any, mockResponse as any, mockNext);
      
      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should not call next when async function succeeds', async () => {
      const asyncFunction = async (req: Request, res: Response, next: NextFunction) => {
        next();
      };
      
      const wrappedFunction = asyncHandler(asyncFunction);
      await wrappedFunction(mockRequest as any, mockResponse as any, mockNext);
      
      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockNext).toHaveBeenCalledWith(); // Called without error
    });
  });

  describe('notFoundHandler', () => {
    it('should return 404 with correct error format', () => {
      notFoundHandler(mockRequest as Request, mockResponse as Response);
      
      expect(mockStatus).toHaveBeenCalledWith(404);
      expect(mockJson).toHaveBeenCalledWith({
        error: {
          code: 'NOT_FOUND',
          message: 'Route /test not found'
        },
        timestamp: expect.any(String),
        path: '/test'
      });
    });
  });
});