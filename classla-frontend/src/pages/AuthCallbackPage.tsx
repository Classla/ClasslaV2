import { useEffect, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

const AuthCallbackPage = () => {
  const [searchParams] = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(true)
  const { user, loading } = useAuth()

  useEffect(() => {
    const processCallback = async () => {
      try {
        // Check for error parameters from WorkOS
        const errorParam = searchParams.get('error')
        const errorDescription = searchParams.get('error_description')
        
        if (errorParam) {
          setError(errorDescription || 'Authentication failed')
          setProcessing(false)
          return
        }

        // Check for authorization code
        const code = searchParams.get('code')
        const state = searchParams.get('state')
        
        if (!code) {
          setError('No authorization code received')
          setProcessing(false)
          return
        }

        // Send the authorization code to our backend
        const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'
        const response = await fetch(`${API_BASE_URL}/auth/callback`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ code, state }),
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Authentication failed')
        }

        // Trigger auth context to refresh user data
        window.dispatchEvent(new CustomEvent('auth:callback-success'))
        
        setProcessing(false)
      } catch (error: any) {
        console.error('Callback processing error:', error)
        setError(error.message || 'Authentication failed')
        setProcessing(false)
      }
    }

    processCallback()
  }, [searchParams])

  // Show loading while processing or while auth context is loading
  if (processing || loading) {
    return (
      <div className="callback-page">
        <div className="callback-container">
          <div className="loading-spinner"></div>
          <h2>Processing Authentication...</h2>
          <p>Please wait while we complete your sign in.</p>
        </div>
      </div>
    )
  }

  // Show error if authentication failed
  if (error) {
    return (
      <div className="callback-page">
        <div className="callback-container">
          <div className="callback-error">
            <h2>Authentication Failed</h2>
            <p>{error}</p>
            <div className="callback-actions">
              <a href="/signin" className="retry-button">
                Try Again
              </a>
              <a href="/signup" className="signup-button">
                Sign Up Instead
              </a>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Redirect to dashboard if authentication was successful
  if (user) {
    return <Navigate to="/" replace />
  }

  // Fallback - redirect to signin if no user and no error
  return <Navigate to="/signin" replace />
}

export default AuthCallbackPage