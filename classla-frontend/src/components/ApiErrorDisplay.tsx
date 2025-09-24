import React from 'react';
import { ApiError } from '../lib/api';

interface ApiErrorDisplayProps {
  error: ApiError | Error | null;
  onRetry?: () => void;
  className?: string;
}

const ApiErrorDisplay: React.FC<ApiErrorDisplayProps> = ({ 
  error, 
  onRetry, 
  className = '' 
}) => {
  if (!error) return null;

  const isApiError = error instanceof ApiError;

  return (
    <div className={`api-error ${className}`}>
      <div className="api-error-title">
        {isApiError ? `Error ${error.statusCode}` : 'Error'}
      </div>
      
      <div className="api-error-message">
        {error.message}
      </div>

      {isApiError && error.code && (
        <div className="api-error-details">
          <strong>Code:</strong> {error.code}
          {error.requestId && (
            <>
              <br />
              <strong>Request ID:</strong> {error.requestId}
            </>
          )}
        </div>
      )}

      {onRetry && (
        <button 
          onClick={onRetry}
          className="retry-button"
          style={{ marginTop: '1rem' }}
        >
          Try Again
        </button>
      )}
    </div>
  );
};

export default ApiErrorDisplay;