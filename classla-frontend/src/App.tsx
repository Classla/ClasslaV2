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
