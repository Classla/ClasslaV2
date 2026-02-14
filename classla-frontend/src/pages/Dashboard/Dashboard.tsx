import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { apiClient } from "../../lib/api";
import DashboardSkeleton from "./DashboardSkeleton";
import { useToast } from "../../hooks/use-toast";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Plus, Users, BookOpen } from "lucide-react";

interface Course {
  id: string;
  name: string;
  description: string;
  join_code: string;
  student_count: number;
  thumbnail_url?: string;
}

const Dashboard: React.FC = () => {
  const { user, refreshUser, isManagedStudent } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [joinDialogOpen, setJoinDialogOpen] = useState(false);
  const [nameDialogOpen, setNameDialogOpen] = useState(false);

  // Form states
  const [newCourseName, setNewCourseName] = useState("");
  const [newCourseDescription, setNewCourseDescription] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    const fetchCourses = async () => {
      if (!user?.id) {
        setLoading(false);
        return;
      }

      try {
        const response = await apiClient.getUserCourses(user.id);
        const coursesData = response.data.data || [];

        // Transform the data to match our Course interface
        const transformedCourses: Course[] = coursesData.map((course: any) => ({
          id: course.id,
          name: course.name,
          description: course.description || "",
          join_code: course.slug,
          student_count: course.student_count || 0,
          thumbnail_url: course.thumbnail_url,
        }));

        setCourses(transformedCourses);
      } catch (error) {
        console.error("Failed to fetch courses:", error);
        setCourses([]);
      } finally {
        setLoading(false);
      }
    };

    fetchCourses();
  }, [user?.id]);

  // Check if user needs to fill in their name
  useEffect(() => {
    if (user && !user.firstName && !user.lastName) {
      setNameDialogOpen(true);
    } else if (user && (user.firstName || user.lastName)) {
      // If user has at least one name, ensure dialog is closed
      setNameDialogOpen(false);
    }
  }, [user]);

  const handleCreateCourse = async () => {
    try {
      const courseData = {
        name: newCourseName,
        description: newCourseDescription,
        settings: {},
        thumbnail_url: "/images/course-default-background.png",
      };

      const response = await apiClient.createCourse(courseData);

      // Add the new course to the list
      const newCourse: Course = {
        id: response.data.id,
        name: response.data.name,
        description: response.data.description || "",
        join_code: response.data.slug,
        student_count: response.data.student_count || 0,
        thumbnail_url: response.data.thumbnail_url,
      };

      setCourses((prevCourses) => [...prevCourses, newCourse]);

      toast({
        title: "Course created successfully!",
        description: `${newCourseName} has been created with join code: ${response.data.slug}`,
      });

      setCreateDialogOpen(false);
      setNewCourseName("");
      setNewCourseDescription("");
    } catch (error: any) {
      console.error("Failed to create course:", error);
      toast({
        title: "Failed to create course",
        description:
          error.message || "An error occurred while creating the course",
        variant: "destructive",
      });
    }
  };

  const handleJoinCourse = async () => {
    try {
      const response = await apiClient.joinCourse({
        slug: joinCode.toUpperCase(),
      });

      // Add the joined course to the list
      const joinedCourse: Course = {
        id: response.data.course.id,
        name: response.data.course.name,
        description: response.data.course.description || "",
        join_code: response.data.course.slug,
        student_count: response.data.course.student_count || 0,
        thumbnail_url: response.data.course.thumbnail_url,
      };

      setCourses((prevCourses) => [...prevCourses, joinedCourse]);

      toast({
        title: "Successfully joined course!",
        description: `You have joined ${response.data.course.name}`,
      });

      setJoinDialogOpen(false);
      setJoinCode("");
    } catch (error: any) {
      console.error("Failed to join course:", error);
      toast({
        title: "Failed to join course",
        description:
          error.message || "Course not found or you may already be enrolled",
        variant: "destructive",
      });
    }
  };

  const handleSaveName = async () => {
    if (!user?.id) return;

    if (!firstName.trim() && !lastName.trim()) {
      toast({
        title: "Name required",
        description: "Please enter at least your first or last name",
        variant: "destructive",
      });
      return;
    }

    try {
      setSavingName(true);
      await apiClient.updateUser(user.id, {
        first_name: firstName.trim() || undefined,
        last_name: lastName.trim() || undefined,
      });

      // Refresh user data to get updated name
      await refreshUser();

      toast({
        title: "Name updated successfully!",
        description: "Your name has been saved.",
      });

      setNameDialogOpen(false);
      setFirstName("");
      setLastName("");
    } catch (error: any) {
      console.error("Failed to update name:", error);
      toast({
        title: "Failed to update name",
        description:
          error.response?.data?.error?.message ||
          "An error occurred while updating your name",
        variant: "destructive",
      });
    } finally {
      setSavingName(false);
    }
  };

  if (loading) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="space-y-8">
      {/* Name Collection Dialog */}
      <Dialog
        open={nameDialogOpen}
        onOpenChange={(open) => {
          // Only allow closing if at least one name is filled in
          if (!open && (!firstName.trim() && !lastName.trim())) {
            return; // Prevent closing
          }
          setNameDialogOpen(open);
        }}
      >
        <DialogContent
          onInteractOutside={(e) => {
            // Prevent closing by clicking outside if name is not filled
            if (!firstName.trim() && !lastName.trim()) {
              e.preventDefault();
            }
          }}
          onEscapeKeyDown={(e) => {
            // Prevent closing with Escape if name is not filled
            if (!firstName.trim() && !lastName.trim()) {
              e.preventDefault();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Welcome! Let's get to know you</DialogTitle>
            <DialogDescription>
              Please provide your name so we can personalize your experience.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="first-name">First Name</Label>
              <Input
                id="first-name"
                placeholder="Enter your first name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (firstName.trim() || lastName.trim())) {
                    handleSaveName();
                  }
                }}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="last-name">Last Name</Label>
              <Input
                id="last-name"
                placeholder="Enter your last name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (firstName.trim() || lastName.trim())) {
                    handleSaveName();
                  }
                }}
              />
            </div>
            <p className="text-sm text-gray-500">
              At least one name is required to continue.
            </p>
          </div>
          <DialogFooter>
            <Button
              onClick={handleSaveName}
              disabled={savingName || (!firstName.trim() && !lastName.trim())}
              className="bg-purple-600 hover:bg-purple-700"
            >
              {savingName ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-600 mt-1">
            Welcome back, {user?.firstName || user?.email?.split("@")[0]}!
          </p>
        </div>

        {!isManagedStudent && (
          <div className="flex space-x-3">
            <Dialog open={joinDialogOpen} onOpenChange={setJoinDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  className="border-purple-600 text-purple-600 hover:bg-purple-50"
                >
                  <BookOpen className="w-4 h-4 mr-2" />
                  Join Course
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Join a Course</DialogTitle>
                  <DialogDescription>
                    Enter the course join code provided by your instructor.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="join-code">Course Join Code</Label>
                    <Input
                      id="join-code"
                      placeholder="Enter join code (e.g., ABC123)"
                      value={joinCode}
                      onChange={(e) => {
                        const value = e.target.value
                          .toUpperCase()
                          .replace(/[^A-Z0-9]/g, "");
                        setJoinCode(value);
                      }}
                      maxLength={6}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setJoinDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleJoinCourse}
                    disabled={joinCode.length !== 6}
                    className="bg-purple-600 hover:bg-purple-700"
                  >
                    Join Course
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button className="bg-purple-600 hover:bg-purple-700">
                  <Plus className="w-4 h-4 mr-2" />
                  Create Course
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create New Course</DialogTitle>
                  <DialogDescription>
                    Create a new course and start teaching your students.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="course-name">Course Name</Label>
                    <Input
                      id="course-name"
                      placeholder="Enter course name"
                      value={newCourseName}
                      onChange={(e) => setNewCourseName(e.target.value)}
                      maxLength={150}
                    />
                    <p className="text-sm text-gray-500 text-right">
                      {newCourseName.length}/150
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="course-description">Course Description</Label>
                    <Input
                      id="course-description"
                      placeholder="Enter course description"
                      value={newCourseDescription}
                      onChange={(e) => setNewCourseDescription(e.target.value)}
                      maxLength={250}
                    />
                    <p className="text-sm text-gray-500 text-right">
                      {newCourseDescription.length}/250
                    </p>
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setCreateDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleCreateCourse}
                    disabled={!newCourseName.trim()}
                    className="bg-purple-600 hover:bg-purple-700"
                  >
                    Create Course
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </div>

      {/* Courses Grid */}
      {courses.length === 0 ? (
        <div className="text-center py-12">
          <BookOpen className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            No courses found
          </h3>
          <p className="text-gray-600 mb-6">
            {isManagedStudent
              ? "You haven't been enrolled in any courses yet. Please contact your teacher."
              : "It looks like you're not part of any courses yet. Create or join one to get started!"}
          </p>
          {!isManagedStudent && (
            <div className="flex justify-center space-x-3">
              <Button
                variant="outline"
                onClick={() => setJoinDialogOpen(true)}
                className="border-purple-600 text-purple-600 hover:bg-purple-50"
              >
                Join Course
              </Button>
              <Button
                onClick={() => setCreateDialogOpen(true)}
                className="bg-purple-600 hover:bg-purple-700"
              >
                Create Course
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {courses.map((course) => (
            <Card
              key={course.id}
              className="hover:shadow-lg transition-shadow duration-200 cursor-pointer group"
              onClick={() => {
                navigate(`/course/${course.join_code}/summary`);
              }}
            >
              <CardHeader className="pb-3">
                <div className="w-full h-48 rounded-md mb-3 overflow-hidden">
                  <img
                    src={
                      course.thumbnail_url ||
                      "/images/course-default-background.png"
                    }
                    alt={course.name}
                    className="w-full h-full object-cover object-top"
                  />
                </div>
                <CardTitle className="text-lg group-hover:text-purple-600 transition-colors">
                  {course.name}
                </CardTitle>
                <CardDescription className="line-clamp-2">
                  {course.description}
                </CardDescription>
              </CardHeader>
              <CardFooter className="pt-0">
                <div className="flex items-center text-sm text-gray-500">
                  <Users className="w-4 h-4 mr-1" />
                  <span>
                    {course.student_count} {course.student_count === 1 ? "student" : "students"}
                  </span>
                </div>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default Dashboard;
