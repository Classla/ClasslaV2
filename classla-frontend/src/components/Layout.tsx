import { Outlet, Link, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import Logo from "./Logo";
import { Button } from "./ui/button";

const Layout = () => {
  const { signOut } = useAuth();
  const location = useLocation();

  // Check if we're on a course page
  const isCoursePage = location.pathname.startsWith("/course/");

  const handleSignOut = async () => {
    await signOut();
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {!isCoursePage && (
        <header className="bg-purple-600 shadow-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-4">
                <Link to="/" className="flex items-center space-x-3">
                  <Logo size="sm" variant="white" showFallback={true} />
                  <span className="text-white text-xl font-semibold">
                    Classla
                  </span>
                </Link>
              </div>

              <nav className="flex items-center space-x-6">
                <Link
                  to="/"
                  className="text-purple-100 hover:text-white transition-colors duration-200"
                >
                  Dashboard
                </Link>
                <Link
                  to="/templates"
                  className="text-purple-100 hover:text-white transition-colors duration-200"
                >
                  Templates
                </Link>
                <Link
                  to="/settings"
                  className="text-purple-100 hover:text-white transition-colors duration-200"
                >
                  Settings
                </Link>
                <Button
                  onClick={handleSignOut}
                  variant="ghost"
                  className="text-purple-100 hover:bg-purple-500 hover:text-white border-0 transition-colors duration-200"
                >
                  Sign Out
                </Button>
              </nav>
            </div>
          </div>
        </header>
      )}

      <main
        className={
          isCoursePage ? "" : "max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8"
        }
      >
        <Outlet />
      </main>
    </div>
  );
};

export default Layout;
