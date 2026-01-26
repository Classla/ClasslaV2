import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { authService, User, SessionInfo } from '../services/auth'

interface AuthContextType {
  user: User | null
  session: SessionInfo | null
  loading: boolean
  signInWithPassword: (email: string, password: string) => Promise<void>
  signInManagedStudent: (username: string, password: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  signUp: () => Promise<void>
  signUpWithPassword: (email: string, password: string, firstName?: string, lastName?: string) => Promise<void>
  signOut: () => Promise<void>
  refreshUser: () => Promise<void>
  isAuthenticated: boolean
  isManagedStudent: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

interface AuthProviderProps {
  children: ReactNode
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [loading, setLoading] = useState(true)

  // Check authentication status and load user data
  const checkAuthStatus = async () => {
    // Skip auth check for test routes in development
    if (process.env.NODE_ENV === 'development' && window.location.pathname.startsWith('/test/')) {
      setLoading(false)
      setUser(null)
      setSession(null)
      return
    }
    
    try {
      setLoading(true)
      const currentUser = await authService.getCurrentUser()
      const sessionInfo = await authService.getSessionInfo()
      
      setUser(currentUser)
      setSession(sessionInfo)
    } catch (error) {
      console.error('Auth check failed:', error)
      setUser(null)
      setSession(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Check if we just came back from auth callback
    const urlParams = new URLSearchParams(window.location.search)
    const authSuccess = urlParams.get('auth') === 'success'
    
    if (authSuccess) {
      // Add a small delay to ensure session cookie is set
      setTimeout(() => {
        checkAuthStatus()
      }, 100)
      
      // Clean up the URL parameter
      const newUrl = window.location.pathname
      window.history.replaceState({}, '', newUrl)
    } else {
      // Normal auth check
      checkAuthStatus()
    }

    // Listen for session expiry events from the auth service
    const handleSessionExpired = () => {
      setUser(null)
      setSession(null)
      setLoading(false)
    }

    // Listen for auth callback success (when user returns from WorkOS)
    const handleAuthCallback = () => {
      // Re-check auth status after callback
      checkAuthStatus()
    }

    window.addEventListener('auth:session-expired', handleSessionExpired)
    window.addEventListener('auth:callback-success', handleAuthCallback)

    return () => {
      window.removeEventListener('auth:session-expired', handleSessionExpired)
      window.removeEventListener('auth:callback-success', handleAuthCallback)
    }
  }, [])

  const signInWithPassword = async (email: string, password: string) => {
    try {
      setLoading(true)
      await authService.signInWithPassword(email, password)
      // After successful password auth, check auth status
      await checkAuthStatus()
    } catch (error) {
      console.error('Password sign in failed:', error)
      setLoading(false)
      throw error
    }
  }

  const signInManagedStudent = async (username: string, password: string) => {
    try {
      setLoading(true)
      await authService.signInManagedStudent(username, password)
      // After successful managed student auth, check auth status
      await checkAuthStatus()
    } catch (error) {
      console.error('Managed student sign in failed:', error)
      setLoading(false)
      throw error
    }
  }

  const signInWithGoogle = async () => {
    try {
      setLoading(true)
      await authService.signInWithGoogle()
    } catch (error) {
      console.error('Google sign in failed:', error)
      setLoading(false)
      throw error
    }
  }

  const signUp = async () => {
    try {
      setLoading(true)
      await authService.redirectToSignup()
    } catch (error) {
      console.error('Sign up failed:', error)
      setLoading(false)
      throw error
    }
  }

  const signUpWithPassword = async (email: string, password: string, firstName?: string, lastName?: string) => {
    try {
      setLoading(true)
      await authService.signUpWithPassword(email, password, firstName, lastName)
      // After successful signup, check auth status
      await checkAuthStatus()
    } catch (error) {
      console.error('Password sign up failed:', error)
      setLoading(false)
      throw error
    }
  }

  const signOut = async () => {
    try {
      setLoading(true)
      await authService.logout()
      setUser(null)
      setSession(null)
    } catch (error) {
      console.error('Sign out failed:', error)
      // Clear local state even if server logout fails
      setUser(null)
      setSession(null)
    } finally {
      setLoading(false)
    }
  }

  const refreshUser = async () => {
    await checkAuthStatus()
  }

  const value = {
    user,
    session,
    loading,
    signInWithPassword,
    signInManagedStudent,
    signInWithGoogle,
    signUp,
    signUpWithPassword,
    signOut,
    refreshUser,
    isAuthenticated: user !== null,
    isManagedStudent: user?.isManagedStudent === true,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}