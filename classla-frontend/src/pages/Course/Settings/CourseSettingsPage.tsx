import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Textarea } from "../../../components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../../components/ui/dialog";
import { apiClient } from "../../../lib/api";
import { Trash2, Save } from "lucide-react";

interface CourseSettingsPageProps {
  course?: any;
  setCourse?: (course: any) => void;
  isInstructor?: boolean;
}

const CourseSettingsPage: React.FC<CourseSettingsPageProps> = ({
  course,
  setCourse,
  isInstructor,
}) => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: course?.name || "",
    description: course?.description || "",
  });

  // Only instructors can access settings
  if (!isInstructor) {
    return (
      <div className="p-8 text-center text-gray-600">
        <p>You don't have permission to access course settings.</p>
      </div>
    );
  }

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSave = async () => {
    if (!course?.id) return;

    setIsLoading(true);
    try {
      const response = await apiClient.updateCourse(course.id, {
        name: formData.name,
        description: formData.description,
      });

      // Update the course in parent component
      if (setCourse) {
        setCourse(response.data);
      }

      // Show success message (you might want to add a toast notification here)
      console.log("Course updated successfully");
    } catch (error) {
      console.error("Error updating course:", error);
      // Handle error (you might want to show an error toast here)
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!course?.id) return;

    setIsDeleting(true);
    try {
      await apiClient.deleteCourse(course.id);

      // Navigate back to dashboard after successful deletion
      navigate("/dashboard");
    } catch (error) {
      console.error("Error deleting course:", error);
      // Handle error (you might want to show an error toast here)
    } finally {
      setIsDeleting(false);
      setDeleteDialogOpen(false);
    }
  };

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Course Settings
        </h1>
        <p className="text-gray-600">
          Manage your course information and settings.
        </p>
      </div>

      <div className="space-y-6">
        {/* Course Name */}
        <div>
          <label
            htmlFor="name"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Course Name
          </label>
          <Input
            id="name"
            name="name"
            value={formData.name}
            onChange={handleInputChange}
            placeholder="Enter course name"
            className="w-full"
          />
        </div>

        {/* Course Description */}
        <div>
          <label
            htmlFor="description"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Description
          </label>
          <Textarea
            id="description"
            name="description"
            value={formData.description}
            onChange={handleInputChange}
            placeholder="Enter course description"
            className="w-full"
            rows={4}
          />
        </div>

        {/* Action Buttons */}
        <div className="flex justify-between pt-6 border-t">
          <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="destructive" className="flex items-center gap-2">
                <Trash2 className="h-4 w-4" />
                Delete Course
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete Course</DialogTitle>
                <DialogDescription>
                  Are you sure you want to delete "{course?.name}"? This action
                  cannot be undone. All assignments, submissions, and
                  enrollments will be permanently removed.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setDeleteDialogOpen(false)}
                  disabled={isDeleting}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={isDeleting}
                >
                  {isDeleting ? "Deleting..." : "Delete Course"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Button
            onClick={handleSave}
            disabled={isLoading}
            className="flex items-center gap-2"
          >
            <Save className="h-4 w-4" />
            {isLoading ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default CourseSettingsPage;
