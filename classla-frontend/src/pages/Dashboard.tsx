import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { apiClient } from "../lib/api";
import { useToast } from "../hooks/use-toast";
import { Button } from "../components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
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
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [joinDialogOpen, setJoinDialogOpen] = useState(false);

  // Form states
  const [newCourseName, setNewCourseName] = useState("");
  const [newCourseDescription, setNewCourseDescription] = useState("");
  const [joinCode, setJoinCode] = useState("");

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
          student_count: 0, // We'll need to add this to the backend response later
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
        student_count: 0,
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
        student_count: 0,
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
        <span className="ml-3 text-gray-600">Loading courses...</span>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-600 mt-1">
            Welcome back, {user?.firstName || user?.email?.split("@")[0]}!
          </p>
        </div>

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
      </div>

      {/* Courses Grid */}
      {courses.length === 0 ? (
        <div className="text-center py-12">
          <BookOpen className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            No courses found
          </h3>
          <p className="text-gray-600 mb-6">
            It looks like you're not part of any courses yet. Create or join one
            to get started!
          </p>
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
                  <span>{course.student_count} students</span>
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
