import { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import DashboardSkeleton from '../pages/Dashboard/DashboardSkeleton'

interface ProtectedRouteProps {
  children: ReactNode
  requireAdmin?: boolean
}

const ProtectedRoute = ({ children, requireAdmin = false }: ProtectedRouteProps) => {
  const { user, loading, isAuthenticated } = useAuth()
  const location = useLocation()

  // Allow test routes in development without authentication
  const isTestRoute = process.env.NODE_ENV === 'development' && location.pathname.startsWith('/test/')
  
  if (isTestRoute) {
    // Test routes don't require authentication
    return <>{children}</>
  }

  // Show loading state while checking authentication
  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <DashboardSkeleton />
      </div>
    )
  }

  // Redirect to signin if not authenticated
  if (!isAuthenticated || !user) {
    // Preserve the intended destination for redirect after login
    return <Navigate to="/signin" state={{ from: location }} replace />
  }

  // Check admin requirement if specified
  if (requireAdmin && !user.isAdmin) {
    return (
      <div className="access-denied" style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '200px',
        flexDirection: 'column',
        gap: '1rem',
        textAlign: 'center'
      }}>
        <h2>Access Denied</h2>
        <p>You don't have permission to access this page.</p>
        <p>Administrator privileges are required.</p>
      </div>
    )
  }

  return <>{children}</>
}

export default ProtectedRoute