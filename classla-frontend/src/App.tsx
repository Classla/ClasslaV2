import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import Layout from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";
import ErrorBoundary from "./components/ErrorBoundary";
import SignInPage from "./pages/SignInPage";
import SignUpPage from "./pages/SignUpPage";
import AuthCallbackPage from "./pages/AuthCallbackPage";
import Dashboard from "./pages/Dashboard/Dashboard";
import UserSettings from "./pages/Settings/UserSettings";
import CourseLayout from "./pages/Course/components/CourseLayout";
import CoursePage from "./pages/Course/CoursePage";
import JoinLinkPage from "./pages/JoinLinkPage";
import TemplatesPage from "./pages/Templates/TemplatesPage";
import OrganizationPage from "./pages/Organizations/OrganizationPage";
import TestIDE from "./pages/TestIDE";
import IDEFullscreenPage from "./pages/IDEFullscreen/IDEFullscreenPage";
import ManagedStudentsPage from "./pages/ManagedStudents/ManagedStudentsPage";
import IDEDashboard from "./pages/Admin/IDEDashboard/IDEDashboard";
import AdminDashboard from "./pages/Admin/AdminDashboard";
import OfficialCoursesPage from "./pages/Admin/OfficialCourses/OfficialCoursesPage";
import AdminTemplatesPage from "./pages/Admin/Templates/AdminTemplatesPage";
import { Toaster } from "./components/ui/toaster";
import "./App.css";

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <Router>
          <Routes>
            <Route path="/signin" element={<SignInPage />} />
            <Route path="/signup" element={<SignUpPage />} />
            <Route path="/auth/callback" element={<AuthCallbackPage />} />
            <Route path="/join/:linkId" element={<JoinLinkPage />} />
            {/* Test page - only available in development, no auth required */}
            {process.env.NODE_ENV === "development" && (
              <Route path="/test/ide" element={<TestIDE />} />
            )}
            {/* IDE Fullscreen - Protected route outside CourseLayout for true fullscreen */}
            <Route
              path="/ide-fullscreen/:blockId"
              element={
                <ProtectedRoute>
                  <IDEFullscreenPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Dashboard />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="settings" element={<UserSettings />} />
              <Route path="templates" element={<TemplatesPage />} />
              <Route path="managed-students" element={<ManagedStudentsPage />} />
              <Route
                path="admin"
                element={
                  <ProtectedRoute requireAdmin>
                    <AdminDashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="admin/official-courses"
                element={
                  <ProtectedRoute requireAdmin>
                    <OfficialCoursesPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="admin/templates"
                element={
                  <ProtectedRoute requireAdmin>
                    <AdminTemplatesPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="admin/ide"
                element={
                  <ProtectedRoute requireAdmin>
                    <IDEDashboard />
                  </ProtectedRoute>
                }
              />
            </Route>
            <Route
              path="/course/:courseSlug/*"
              element={
                <ProtectedRoute>
                  <CourseLayout>
                    <CoursePage />
                  </CourseLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/organization/:orgSlug/*"
              element={
                <ProtectedRoute>
                  <OrganizationPage />
                </ProtectedRoute>
              }
            />
          </Routes>
          <Toaster />
        </Router>
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
