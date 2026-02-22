import React, { useEffect, useState, useMemo } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../../contexts/AuthContext";
import { apiClient } from "../../../lib/api";
import { useToast } from "../../../hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import Logo from "../../../components/Logo";
import ModuleTree from "../../../components/ModuleTree";
import { BookOpen, Users, Settings, BarChart3, Plus, FileText, Folder, Sun, Moon } from "lucide-react";
import { Course, UserRole } from "../../../types";
import { hasTAPermission } from "../../../lib/taPermissions";
import { Allotment } from "allotment";
import "allotment/dist/style.css";
import { IDEPanelProvider, useIDEPanel } from "../../../contexts/IDEPanelContext";
import CourseLayoutSkeleton from "./CourseLayoutSkeleton";
import { useTheme } from "../../../hooks/useTheme";

interface CourseLayoutProps {
  children: React.ReactNode;
}

const CourseLayoutInner: React.FC<CourseLayoutProps> = ({ children }) => {
  const { courseSlug } = useParams<{ courseSlug: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const { panelMode } = useIDEPanel();
  const { isDark, toggle } = useTheme();

  const [course, setCourse] = useState<Course | null>(null);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const queryClient = useQueryClient();

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

        // If it's a template, set user as instructor (templates don't have enrollments)
        if (courseData.is_template) {
          setUserRole(UserRole.INSTRUCTOR);
        } else {
          // Fetch user role in this course
          try {
            const roleResponse = await apiClient.getUserRole(courseData.id);
            setUserRole(roleResponse.data.data.role);
          } catch (roleError) {
            console.error("Failed to fetch user role:", roleError);
            // Set a default role or leave as null - the UI will handle this gracefully
            setUserRole(null);
          }
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

  const handleCreateFolder = async () => {
    if (!folderName.trim() || !course) return;
    try {
      await apiClient.createFolder({
        course_id: course.id,
        path: [folderName.trim()],
        name: folderName.trim(),
        order_index: 0,
      });
      queryClient.invalidateQueries({ queryKey: ["courseFolders", course.id] });
      setFolderDialogOpen(false);
      toast({
        title: "Folder created",
        description: "New folder has been created successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error creating folder",
        description: error.message || "Failed to create folder",
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
  const isInstructorOrAdmin =
    userRole === UserRole.INSTRUCTOR || userRole === UserRole.ADMIN;

  // Check if TA has canCreate permission
  const canCreate = useMemo(() => {
    if (!isInstructor) return false;
    if (userRole !== UserRole.TEACHING_ASSISTANT) return true; // Instructors/admins always can create
    return hasTAPermission(course, user?.id, userRole, "canCreate");
  }, [isInstructor, userRole, course, user?.id]);

  const isTemplate = course?.is_template === true;

  const navigationTabs = [
    { id: "summary", label: "Summary", icon: BookOpen, path: "summary" },
    ...(!isTemplate
      ? [
          {
            id: "students",
            label: "Students",
            icon: Users,
            path: "students",
          },
        ]
      : []),
    ...(!isTemplate && isInstructor
      ? [
          {
            id: "gradebook",
            label: "Gradebook",
            icon: BarChart3,
            path: "gradebook",
          },
        ]
      : !isTemplate
      ? [{ id: "grades", label: "Grades", icon: BarChart3, path: "grades" }]
      : []),
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
    return <CourseLayoutSkeleton />;
  }

  if (!course) {
    return (
      <div className="text-center py-12">
        <h3 className="text-lg font-medium text-foreground mb-2">
          Course not found
        </h3>
        <p className="text-muted-foreground mb-6">
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
    <div className="h-screen bg-background flex flex-col">
      {/* Course Header */}
      <header className="bg-purple-600 dark:bg-purple-900 shadow-sm">
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
              {isInstructorOrAdmin && (
                <Button
                  onClick={() => navigate("/settings")}
                  variant="ghost"
                  className="text-purple-100 hover:bg-purple-500 hover:text-white border-0 transition-colors duration-200"
                >
                  Settings
                </Button>
              )}
              <button
                onClick={toggle}
                className="text-purple-100 hover:text-white transition-colors duration-200 p-2"
                aria-label="Toggle dark mode"
              >
                {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              </button>
            </nav>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-hidden">
        <Allotment>
          {/* Sidebar - Resizable - Hidden in side-panel mode */}
          {panelMode !== 'side-panel' && (
            <Allotment.Pane minSize={200} maxSize={400} preferredSize={256}>
              <div className="h-full bg-card border-r border-border flex flex-col">
                {/* Navigation Items */}
                <div className="flex-1 overflow-hidden flex flex-col pt-6">
                  <nav className="space-y-1 px-3 shrink-0">
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
                              ? "bg-primary/10 text-primary"
                              : "text-muted-foreground hover:bg-accent hover:text-foreground"
                          }`}
                        >
                          <Icon className="w-5 h-5" />
                          <span>{tab.label}</span>
                        </button>
                      );
                    })}
                  </nav>

                  {/* Assignments Section */}
                  <div className="mt-8 px-3 flex-1 min-h-0 flex flex-col">
                    <ModuleTree
                      courseId={course.id}
                      course={course}
                      userRole={userRole || undefined}
                      isStudent={isStudent}
                      isInstructor={isInstructor}
                    />
                  </div>
                </div>

                {/* Create button at bottom */}
                {canCreate && (
                  <div className="border-t border-border p-3">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button className="w-full bg-purple-600 hover:bg-purple-700 dark:bg-purple-800 dark:hover:bg-purple-900 text-white">
                          <Plus className="w-4 h-4 mr-2" />
                          Create
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" side="top" className="w-48">
                        <DropdownMenuItem
                          onClick={async () => {
                            try {
                              const response = await apiClient.createAssignment({
                                name: "New Assignment",
                                course_id: course.id,
                                module_path: [],
                                settings: {},
                                content: "",
                                publish_times: {},
                                due_dates_map: {},
                                is_lockdown: false,
                                lockdown_time_map: {},
                                order_index: 0,
                              });

                              queryClient.invalidateQueries({ queryKey: ["courseAssignments", course.id] });

                              const newAssignment = response.data;
                              navigate(`/course/${courseSlug}/assignment/${newAssignment.id}`);

                              toast({
                                title: "Assignment created",
                                description: "New assignment has been created successfully",
                              });
                            } catch (error: any) {
                              toast({
                                title: "Error creating assignment",
                                description: error.message || "Failed to create assignment",
                                variant: "destructive",
                              });
                            }
                          }}
                          className="cursor-pointer"
                        >
                          <FileText className="w-4 h-4 mr-2" />
                          Create Assignment
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            setFolderName("");
                            setFolderDialogOpen(true);
                          }}
                          className="cursor-pointer"
                        >
                          <Folder className="w-4 h-4 mr-2" />
                          Create Folder
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
              </div>
            </Allotment.Pane>
          )}

          {/* Main Content */}
          <Allotment.Pane minSize={400}>
            <div className="h-full overflow-auto">
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
          </Allotment.Pane>
        </Allotment>
      </div>

      {/* Create Folder Dialog */}
      <Dialog open={folderDialogOpen} onOpenChange={setFolderDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Create Folder</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="folder-name">Folder name</Label>
            <Input
              id="folder-name"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="Enter folder name"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && folderName.trim()) {
                  e.preventDefault();
                  handleCreateFolder();
                }
              }}
              className="mt-2"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFolderDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateFolder}
              disabled={!folderName.trim()}
              className="bg-purple-600 hover:bg-purple-700 dark:bg-purple-800 dark:hover:bg-purple-900 text-white"
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// Wrap with IDEPanelProvider to enable IDE panel functionality
const CourseLayout: React.FC<CourseLayoutProps> = (props) => {
  return (
    <IDEPanelProvider>
      <CourseLayoutInner {...props} />
    </IDEPanelProvider>
  );
};

export default CourseLayout;
