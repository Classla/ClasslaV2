import React, { useEffect, useState, useCallback } from "react";
import { apiClient } from "../../../lib/api";
import { useToast } from "../../../hooks/use-toast";
import { Button } from "../../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../../components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { Input } from "../../../components/ui/input";
import {
  BookOpen,
  Plus,
  Trash2,
  Users,
  RefreshCw,
  Loader2,
} from "lucide-react";

interface OfficialCourse {
  id: string;
  name: string;
  slug: string;
  is_official: boolean;
  student_count: number;
  created_at: string;
}

interface AutoEnrollInfo {
  enabled: boolean;
  course: { id: string; name: string; slug: string } | null;
}

const OfficialCoursesPage: React.FC = () => {
  const { toast } = useToast();
  const [courses, setCourses] = useState<OfficialCourse[]>([]);
  const [autoEnroll, setAutoEnroll] = useState<AutoEnrollInfo>({
    enabled: false,
    course: null,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [selectedAutoEnrollId, setSelectedAutoEnrollId] = useState<string>("");

  // Create dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [newCourseName, setNewCourseName] = useState("");
  const [creating, setCreating] = useState(false);

  // Confirm dialogs
  const [removeTarget, setRemoveTarget] = useState<OfficialCourse | null>(null);
  const [showExecuteConfirm, setShowExecuteConfirm] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [coursesRes, autoEnrollRes] = await Promise.all([
        apiClient.admin.getOfficialCourses(),
        apiClient.admin.getAutoEnroll(),
      ]);
      setCourses(coursesRes.data.courses);
      setAutoEnroll(autoEnrollRes.data);
      setSelectedAutoEnrollId(autoEnrollRes.data.course?.id ?? "none");
    } catch (error: any) {
      toast({
        title: "Failed to load data",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSaveAutoEnroll = async () => {
    setSaving(true);
    try {
      const courseId =
        selectedAutoEnrollId === "none" ? null : selectedAutoEnrollId;
      await apiClient.admin.setAutoEnroll(courseId);
      await fetchData();
      toast({ title: "Auto-enrollment updated" });
    } catch (error: any) {
      toast({
        title: "Failed to update",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleExecuteAutoEnroll = async () => {
    setShowExecuteConfirm(false);
    setExecuting(true);
    try {
      const res = await apiClient.admin.executeAutoEnroll();
      toast({
        title: "Enrollment complete",
        description: `${res.data.enrolled_count} users enrolled`,
      });
    } catch (error: any) {
      toast({
        title: "Failed to execute",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setExecuting(false);
    }
  };

  const handleCreateCourse = async () => {
    if (!newCourseName.trim()) return;
    setCreating(true);
    try {
      await apiClient.admin.createOfficialCourse(newCourseName.trim());
      setCreateOpen(false);
      setNewCourseName("");
      await fetchData();
      toast({ title: "Official course created" });
    } catch (error: any) {
      toast({
        title: "Failed to create course",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const handleRemoveOfficial = async () => {
    if (!removeTarget) return;
    try {
      // If this course is the auto-enroll course, clear auto-enroll first
      if (autoEnroll.course?.id === removeTarget.id) {
        await apiClient.admin.setAutoEnroll(null);
      }
      await apiClient.admin.toggleOfficialCourse(removeTarget.id, false);
      setRemoveTarget(null);
      await fetchData();
      toast({ title: "Course removed from official list" });
    } catch (error: any) {
      toast({
        title: "Failed to remove",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground">
          Official Courses
        </h1>
        <p className="text-muted-foreground mt-1">
          Manage official Classla courses and auto-enrollment settings
        </p>
      </div>

      {/* Auto-Enrollment Section */}
      <Card className="border border-border mb-8">
        <CardHeader>
          <CardTitle className="text-foreground">Auto-Enrollment</CardTitle>
          <CardDescription>
            New accounts will be automatically enrolled in the selected course
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <Select
              value={selectedAutoEnrollId}
              onValueChange={setSelectedAutoEnrollId}
            >
              <SelectTrigger className="w-[300px]">
                <SelectValue placeholder="Select a course" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Disabled</SelectItem>
                {courses.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              onClick={handleSaveAutoEnroll}
              disabled={saving}
              className="bg-purple-600 hover:bg-purple-700 dark:bg-purple-800 dark:hover:bg-purple-900 text-white"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : null}
              Save
            </Button>
          </div>
          {autoEnroll.enabled && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => setShowExecuteConfirm(true)}
                disabled={executing}
              >
                {executing ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Users className="w-4 h-4 mr-2" />
                )}
                Enroll All Existing Users
              </Button>
              <span className="text-sm text-muted-foreground">
                Currently auto-enrolling into:{" "}
                <strong>{autoEnroll.course?.name}</strong>
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Official Courses Table */}
      <Card className="border border-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-foreground">
                Official Courses
              </CardTitle>
              <CardDescription>
                {courses.length} official{" "}
                {courses.length === 1 ? "course" : "courses"}
              </CardDescription>
            </div>
            <Button
              onClick={() => {
                setCreateOpen(true);
                setNewCourseName("");
              }}
              className="bg-purple-600 hover:bg-purple-700 dark:bg-purple-800 dark:hover:bg-purple-900 text-white"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create Course
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {courses.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <BookOpen className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No official courses yet</p>
              <p className="text-sm mt-1">
                Click "Create Course" to add an official course
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Join Code</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {courses.map((course) => (
                  <TableRow key={course.id}>
                    <TableCell className="font-medium">
                      {course.name}
                    </TableCell>
                    <TableCell>
                      <code className="text-sm bg-muted px-2 py-1 rounded">
                        {course.slug}
                      </code>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setRemoveTarget(course)}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create Course Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Official Course</DialogTitle>
            <DialogDescription>
              Create a new course that will be marked as official
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              value={newCourseName}
              onChange={(e) => setNewCourseName(e.target.value)}
              placeholder="Course name"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && newCourseName.trim()) {
                  handleCreateCourse();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateCourse}
              disabled={creating || !newCourseName.trim()}
              className="bg-purple-600 hover:bg-purple-700 dark:bg-purple-800 dark:hover:bg-purple-900 text-white"
            >
              {creating ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove Confirmation */}
      <AlertDialog
        open={!!removeTarget}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Official Course</AlertDialogTitle>
            <AlertDialogDescription>
              Remove "{removeTarget?.name}" from official courses? This will not
              unenroll any students.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemoveOfficial}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Execute Auto-Enroll Confirmation */}
      <AlertDialog
        open={showExecuteConfirm}
        onOpenChange={setShowExecuteConfirm}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enroll All Existing Users</AlertDialogTitle>
            <AlertDialogDescription>
              This will enroll all existing non-managed accounts into "
              {autoEnroll.course?.name}". Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleExecuteAutoEnroll}
              className="bg-purple-600 hover:bg-purple-700 dark:bg-purple-800 dark:hover:bg-purple-900 text-white"
            >
              Enroll All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default OfficialCoursesPage;
