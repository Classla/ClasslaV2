import React, { useEffect, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { apiClient } from "../lib/api";
import { useToast } from "../hooks/use-toast";
import { Button } from "./ui/button";
import Logo from "./Logo";
import ModuleTree from "./ModuleTree";
import { BookOpen, Users, Settings, BarChart3 } from "lucide-react";
import { Course, UserRole } from "../types";

interface CourseLayoutProps {
  children: React.ReactNode;
}

const CourseLayout: React.FC<CourseLayoutProps> = ({ children }) => {
  const { courseSlug } = useParams<{ courseSlug: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const [course, setCourse] = useState<Course | null>(null);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  // Get current page from URL
  const currentPage = location.pathname.split("/").pop() || "summary";

  useEffect(() => {
    const fetchCourseData = async () => {
      if (!courseSlug || !user?.id) {
        setLoading(false);
        return;
      }

      try {
        // Fetch course data
        const courseResponse = await apiClient.getCourseBySlug(courseSlug);
        const courseData = courseResponse.data;

        setCourse(courseData);

        // Fetch user role in this course
        try {
          const roleResponse = await apiClient.getUserRole(courseData.id);
          setUserRole(roleResponse.data.data.role);
        } catch (roleError) {
          console.error("Failed to fetch user role:", roleError);
          // Set a default role or leave as null - the UI will handle this gracefully
          setUserRole(null);
        }
      } catch (error: any) {
        console.error("Failed to fetch course data:", error);
        toast({
          title: "Error loading course",
          description: error.message || "Failed to load course data",
          variant: "destructive",
        });
        navigate("/dashboard");
      } finally {
        setLoading(false);
      }
    };

    fetchCourseData();
  }, [courseSlug, user?.id, navigate, toast]);

  const handleCopyJoinCode = async () => {
    if (!course?.slug) return;

    try {
      await navigator.clipboard.writeText(course.slug);
      setCopied(true);
      toast({
        title: "Join code copied!",
        description: `${course.slug} has been copied to your clipboard`,
      });
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast({
        title: "Failed to copy",
        description: "Could not copy join code to clipboard",
        variant: "destructive",
      });
    }
  };

  const isStudent =
    userRole === UserRole.STUDENT || userRole === UserRole.AUDIT;
  const isInstructor =
    userRole === UserRole.INSTRUCTOR ||
    userRole === UserRole.ADMIN ||
    userRole === UserRole.TEACHING_ASSISTANT;

  const navigationTabs = [
    { id: "summary", label: "Summary", icon: BookOpen, path: "summary" },
    {
      id: "students",
      label: "Students",
      icon: Users,
      path: "students",
    },
    { id: "grades", label: "Grades", icon: BarChart3, path: "grades" },
    ...(isInstructor
      ? [
          {
            id: "settings",
            label: "Settings",
            icon: Settings,
            path: "settings",
          },
        ]
      : []),
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
        <span className="ml-3 text-gray-600">Loading course...</span>
      </div>
    );
  }

  if (!course) {
    return (
      <div className="text-center py-12">
        <h3 className="text-lg font-medium text-gray-900 mb-2">
          Course not found
        </h3>
        <p className="text-gray-600 mb-6">
          The course you're looking for doesn't exist or you don't have access
          to it.
        </p>
        <Button
          onClick={() => navigate("/dashboard")}
          className="bg-purple-600 hover:bg-purple-700"
        >
          Go to Dashboard
        </Button>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gray-50 flex flex-col">
      {/* Course Header */}
      <header className="bg-purple-600 shadow-sm">
        <div className="px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => navigate("/dashboard")}
                className="flex items-center space-x-3 text-white hover:text-purple-100 transition-colors"
              >
                <Logo size="sm" variant="white" showFallback={true} />
                <span className="text-xl font-semibold">Classla</span>
              </button>
              <span className="text-white text-lg">•</span>
              <span className="text-white text-lg font-medium">
                {course.name}
              </span>
            </div>

            <nav className="flex items-center space-x-6">
              <button
                onClick={() => navigate("/dashboard")}
                className="text-purple-100 hover:text-white transition-colors duration-200"
              >
                Dashboard
              </button>
              <Button
                onClick={() => navigate("/settings")}
                variant="ghost"
                className="text-purple-100 hover:bg-purple-500 hover:text-white border-0 transition-colors duration-200"
              >
                Settings
              </Button>
            </nav>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-64 bg-white border-r border-gray-200 flex flex-col">
          {/* Navigation Items */}
          <div className="flex-1 py-6">
            <nav className="space-y-1 px-3">
              {navigationTabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = currentPage === tab.id;

                return (
                  <button
                    key={tab.id}
                    onClick={() =>
                      navigate(`/course/${courseSlug}/${tab.path}`)
                    }
                    className={`w-full flex items-center space-x-3 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                      isActive
                        ? "bg-purple-100 text-purple-700"
                        : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </nav>

            {/* Assignments Section */}
            <div className="mt-8 px-3">
              <ModuleTree
                courseId={course.id}
                userRole={userRole || undefined}
                isStudent={isStudent}
                isInstructor={isInstructor}
              />
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-auto">
          {React.cloneElement(children as React.ReactElement, {
            course,
            setCourse,
            userRole,
            isStudent,
            isInstructor,
            handleCopyJoinCode,
            copied,
          })}
        </div>
      </div>
    </div>
  );
};

export default CourseLayout;
