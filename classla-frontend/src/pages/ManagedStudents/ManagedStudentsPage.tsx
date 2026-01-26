import React, { useState, useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { apiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Users,
  Plus,
  Trash2,
  Key,
  BookOpen,
  X,
  Copy,
  Check,
  Upload,
  Download,
  RefreshCw,
  FileText,
} from "lucide-react";
import type { ManagedStudentWithEnrollments } from "@/types";

interface Course {
  id: string;
  name: string;
}

interface BulkStudent {
  firstName: string;
  lastName: string;
  username: string;
  password: string;
}

// Generate a random password
const generatePassword = (length: number = 12): string => {
  const lowercase = "abcdefghijkmnopqrstuvwxyz";
  const uppercase = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const numbers = "23456789";
  const all = lowercase + uppercase + numbers;

  let password = "";
  // Ensure at least one of each type
  password += lowercase[Math.floor(Math.random() * lowercase.length)];
  password += uppercase[Math.floor(Math.random() * uppercase.length)];
  password += numbers[Math.floor(Math.random() * numbers.length)];

  // Fill the rest randomly
  for (let i = password.length; i < length; i++) {
    password += all[Math.floor(Math.random() * all.length)];
  }

  // Shuffle the password
  return password.split("").sort(() => Math.random() - 0.5).join("");
};

// Generate username from name
const generateUsername = (firstName: string, lastName: string, existingUsernames: Set<string>): string => {
  const cleanFirst = firstName.toLowerCase().replace(/[^a-z]/g, "");
  const cleanLast = lastName.toLowerCase().replace(/[^a-z]/g, "");

  let base = cleanFirst && cleanLast
    ? `${cleanFirst}_${cleanLast}`
    : cleanFirst || cleanLast || "student";

  let username = base;
  let counter = 1;

  while (existingUsernames.has(username)) {
    username = `${base}${counter}`;
    counter++;
  }

  existingUsernames.add(username);
  return username;
};

const ManagedStudentsPage: React.FC = () => {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [students, setStudents] = useState<ManagedStudentWithEnrollments[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [enrollDialogOpen, setEnrollDialogOpen] = useState(false);
  const [bulkImportDialogOpen, setBulkImportDialogOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<ManagedStudentWithEnrollments | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Form state
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newFirstName, setNewFirstName] = useState("");
  const [newLastName, setNewLastName] = useState("");
  const [newCourseId, setNewCourseId] = useState<string>("");
  const [selectedCourseId, setSelectedCourseId] = useState<string>("");
  const [creating, setCreating] = useState(false);

  // Bulk import state
  const [bulkNamesList, setBulkNamesList] = useState("");
  const [bulkStudents, setBulkStudents] = useState<BulkStudent[]>([]);
  const [bulkCourseId, setBulkCourseId] = useState<string>("");
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkResults, setBulkResults] = useState<BulkStudent[] | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [studentsRes, coursesRes] = await Promise.all([
        apiClient.getManagedStudents(),
        apiClient.getManagedStudentCourses(),
      ]);
      setStudents(studentsRes.data.students || []);
      setCourses(coursesRes.data.courses || []);
    } catch (error) {
      console.error("Failed to fetch data:", error);
      toast({
        title: "Error",
        description: "Failed to load students. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateStudent = async () => {
    if (!newUsername || !newPassword) {
      toast({
        title: "Error",
        description: "Username and password are required.",
        variant: "destructive",
      });
      return;
    }

    try {
      setCreating(true);
      await apiClient.createManagedStudent({
        username: newUsername,
        password: newPassword,
        firstName: newFirstName || undefined,
        lastName: newLastName || undefined,
        courseId: newCourseId || undefined,
      });

      toast({
        title: "Success",
        description: "Student account created successfully.",
      });

      // Reset form and refresh
      setNewUsername("");
      setNewPassword("");
      setNewFirstName("");
      setNewLastName("");
      setNewCourseId("");
      setCreateDialogOpen(false);
      fetchData();
    } catch (error: any) {
      console.error("Failed to create student:", error);
      toast({
        title: "Error",
        description: error?.response?.data?.error || "Failed to create student account.",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const handleResetPassword = async (student: ManagedStudentWithEnrollments) => {
    try {
      const response = await apiClient.resetManagedStudentPassword(student.id);
      setTemporaryPassword(response.data.temporaryPassword);
      setSelectedStudent(student);
      setPasswordDialogOpen(true);
      toast({
        title: "Success",
        description: "Password reset successfully.",
      });
    } catch (error) {
      console.error("Failed to reset password:", error);
      toast({
        title: "Error",
        description: "Failed to reset password.",
        variant: "destructive",
      });
    }
  };

  const handleDeleteStudent = async (student: ManagedStudentWithEnrollments) => {
    try {
      await apiClient.deleteManagedStudent(student.id);
      toast({
        title: "Success",
        description: "Student account deleted successfully.",
      });
      fetchData();
    } catch (error) {
      console.error("Failed to delete student:", error);
      toast({
        title: "Error",
        description: "Failed to delete student account.",
        variant: "destructive",
      });
    }
  };

  const handleEnrollStudent = async () => {
    if (!selectedStudent || !selectedCourseId) return;

    try {
      await apiClient.enrollManagedStudent(selectedStudent.id, selectedCourseId);
      toast({
        title: "Success",
        description: "Student enrolled in course successfully.",
      });
      setEnrollDialogOpen(false);
      setSelectedCourseId("");
      fetchData();
    } catch (error: any) {
      console.error("Failed to enroll student:", error);
      toast({
        title: "Error",
        description: error?.response?.data?.error || "Failed to enroll student.",
        variant: "destructive",
      });
    }
  };

  const handleUnenrollStudent = async (studentId: string, courseId: string) => {
    try {
      await apiClient.unenrollManagedStudent(studentId, courseId);
      toast({
        title: "Success",
        description: "Student unenrolled from course successfully.",
      });
      fetchData();
    } catch (error) {
      console.error("Failed to unenroll student:", error);
      toast({
        title: "Error",
        description: "Failed to unenroll student.",
        variant: "destructive",
      });
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleGeneratePassword = () => {
    setNewPassword(generatePassword());
  };

  // Parse names list (comma or newline separated)
  const parseNamesList = (input: string): BulkStudent[] => {
    const existingUsernames = new Set(students.map((s) => s.username));
    const lines = input
      .split(/[,\n]/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    return lines.map((line) => {
      const parts = line.split(/\s+/);
      const firstName = parts[0] || "";
      const lastName = parts.slice(1).join(" ") || "";
      const username = generateUsername(firstName, lastName, existingUsernames);
      const password = generatePassword();

      return { firstName, lastName, username, password };
    });
  };

  // Parse CSV file
  const handleCsvUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text.split("\n").filter((line) => line.trim());

      // Skip header if it looks like one
      const startIndex = lines[0]?.toLowerCase().includes("name") ||
        lines[0]?.toLowerCase().includes("first") ? 1 : 0;

      const existingUsernames = new Set(students.map((s) => s.username));
      const parsed: BulkStudent[] = [];

      for (let i = startIndex; i < lines.length; i++) {
        const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));

        if (cols.length >= 1) {
          let firstName = "";
          let lastName = "";

          if (cols.length >= 2) {
            // Assume first_name, last_name columns
            firstName = cols[0];
            lastName = cols[1];
          } else {
            // Single column - split by space
            const parts = cols[0].split(/\s+/);
            firstName = parts[0] || "";
            lastName = parts.slice(1).join(" ") || "";
          }

          if (firstName || lastName) {
            const username = generateUsername(firstName, lastName, existingUsernames);
            const password = generatePassword();
            parsed.push({ firstName, lastName, username, password });
          }
        }
      }

      setBulkStudents(parsed);
    };
    reader.readAsText(file);

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleParseNamesList = () => {
    const parsed = parseNamesList(bulkNamesList);
    setBulkStudents(parsed);
  };

  const handleBulkImport = async () => {
    if (bulkStudents.length === 0) return;

    setBulkImporting(true);
    const results: BulkStudent[] = [];
    let successCount = 0;
    let failCount = 0;

    for (const student of bulkStudents) {
      try {
        await apiClient.createManagedStudent({
          username: student.username,
          password: student.password,
          firstName: student.firstName || undefined,
          lastName: student.lastName || undefined,
          courseId: bulkCourseId || undefined,
        });
        results.push(student);
        successCount++;
      } catch (error) {
        console.error(`Failed to create ${student.username}:`, error);
        failCount++;
      }
    }

    setBulkResults(results);
    setBulkImporting(false);

    toast({
      title: "Bulk Import Complete",
      description: `Created ${successCount} student${successCount !== 1 ? "s" : ""}${failCount > 0 ? `, ${failCount} failed` : ""}.`,
      variant: failCount > 0 ? "destructive" : "default",
    });

    fetchData();
  };

  const downloadCredentialsCsv = () => {
    if (!bulkResults || bulkResults.length === 0) return;

    const header = "First Name,Last Name,Username,Password\n";
    const rows = bulkResults
      .map((s) => `"${s.firstName}","${s.lastName}","${s.username}","${s.password}"`)
      .join("\n");

    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "student_credentials.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const resetBulkImport = () => {
    setBulkNamesList("");
    setBulkStudents([]);
    setBulkCourseId("");
    setBulkResults(null);
  };

  const getDisplayName = (student: ManagedStudentWithEnrollments) => {
    if (student.first_name || student.last_name) {
      return `${student.first_name || ""} ${student.last_name || ""}`.trim();
    }
    return student.username;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Managed Students</h1>
          <p className="text-muted-foreground">
            Create and manage student accounts for your courses.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { resetBulkImport(); setBulkImportDialogOpen(true); }}>
            <Upload className="h-4 w-4 mr-2" />
            Bulk Import
          </Button>
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add Student
              </Button>
            </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Student Account</DialogTitle>
              <DialogDescription>
                Create a new student account with a username and password.
                Students will use these credentials to sign in.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="username">Username *</Label>
                <Input
                  id="username"
                  placeholder="student_username"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Letters, numbers, and underscores only. 3-30 characters.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password *</Label>
                <div className="flex gap-2">
                  <Input
                    id="password"
                    type="text"
                    placeholder="Initial password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={handleGeneratePassword}
                    title="Generate password"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  At least 8 characters. Share this with the student.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First Name</Label>
                  <Input
                    id="firstName"
                    placeholder="First name"
                    value={newFirstName}
                    onChange={(e) => setNewFirstName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name</Label>
                  <Input
                    id="lastName"
                    placeholder="Last name"
                    value={newLastName}
                    onChange={(e) => setNewLastName(e.target.value)}
                  />
                </div>
              </div>
              {courses.length > 0 && (
                <div className="space-y-2">
                  <Label htmlFor="course">Enroll in Course (Optional)</Label>
                  <Select value={newCourseId || "none"} onValueChange={(val) => setNewCourseId(val === "none" ? "" : val)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a course..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No course</SelectItem>
                      {courses.map((course) => (
                        <SelectItem key={course.id} value={course.id}>
                          {course.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setCreateDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button onClick={handleCreateStudent} disabled={creating}>
                {creating ? "Creating..." : "Create Student"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* Bulk Import Dialog */}
      <Dialog open={bulkImportDialogOpen} onOpenChange={(open) => { if (!open) resetBulkImport(); setBulkImportDialogOpen(open); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Bulk Import Students</DialogTitle>
            <DialogDescription>
              Import multiple students at once from a CSV file or a list of names.
            </DialogDescription>
          </DialogHeader>

          {bulkResults ? (
            // Results view
            <div className="space-y-4 py-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Successfully created {bulkResults.length} student{bulkResults.length !== 1 ? "s" : ""}.
                </p>
                <Button onClick={downloadCredentialsCsv} variant="outline" size="sm">
                  <Download className="h-4 w-4 mr-2" />
                  Download Credentials CSV
                </Button>
              </div>
              <div className="border rounded-md max-h-64 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="text-left p-2">Name</th>
                      <th className="text-left p-2">Username</th>
                      <th className="text-left p-2">Password</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkResults.map((s, i) => (
                      <tr key={i} className="border-t">
                        <td className="p-2">{s.firstName} {s.lastName}</td>
                        <td className="p-2 font-mono">{s.username}</td>
                        <td className="p-2 font-mono">{s.password}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <DialogFooter>
                <Button onClick={() => setBulkImportDialogOpen(false)}>Done</Button>
              </DialogFooter>
            </div>
          ) : bulkStudents.length > 0 ? (
            // Preview view
            <div className="space-y-4 py-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {bulkStudents.length} student{bulkStudents.length !== 1 ? "s" : ""} to import
                </p>
                <Button onClick={() => setBulkStudents([])} variant="ghost" size="sm">
                  Clear
                </Button>
              </div>
              <div className="border rounded-md max-h-48 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="text-left p-2">Name</th>
                      <th className="text-left p-2">Username</th>
                      <th className="text-left p-2">Password</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkStudents.map((s, i) => (
                      <tr key={i} className="border-t">
                        <td className="p-2">{s.firstName} {s.lastName}</td>
                        <td className="p-2 font-mono text-xs">{s.username}</td>
                        <td className="p-2 font-mono text-xs">{s.password}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {courses.length > 0 && (
                <div className="space-y-2">
                  <Label>Enroll in Course (Optional)</Label>
                  <Select value={bulkCourseId || "none"} onValueChange={(val) => setBulkCourseId(val === "none" ? "" : val)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a course..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No course</SelectItem>
                      {courses.map((course) => (
                        <SelectItem key={course.id} value={course.id}>
                          {course.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setBulkStudents([])}>
                  Back
                </Button>
                <Button onClick={handleBulkImport} disabled={bulkImporting}>
                  {bulkImporting ? "Importing..." : `Import ${bulkStudents.length} Student${bulkStudents.length !== 1 ? "s" : ""}`}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            // Input view
            <Tabs defaultValue="list" className="py-4">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="list">
                  <FileText className="h-4 w-4 mr-2" />
                  Name List
                </TabsTrigger>
                <TabsTrigger value="csv">
                  <Upload className="h-4 w-4 mr-2" />
                  CSV File
                </TabsTrigger>
              </TabsList>
              <TabsContent value="list" className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label>Enter names (one per line or comma-separated)</Label>
                  <Textarea
                    placeholder="John Smith, Jane Doe&#10;Bob Johnson&#10;Alice Williams"
                    value={bulkNamesList}
                    onChange={(e) => setBulkNamesList(e.target.value)}
                    rows={6}
                  />
                  <p className="text-xs text-muted-foreground">
                    Enter first and last names. Usernames and passwords will be generated automatically.
                  </p>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setBulkImportDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleParseNamesList} disabled={!bulkNamesList.trim()}>
                    Preview Students
                  </Button>
                </DialogFooter>
              </TabsContent>
              <TabsContent value="csv" className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label>Upload CSV file</Label>
                  <div className="border-2 border-dashed rounded-md p-6 text-center">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv"
                      onChange={handleCsvUpload}
                      className="hidden"
                      id="csv-upload"
                    />
                    <label htmlFor="csv-upload" className="cursor-pointer">
                      <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                      <p className="text-sm text-muted-foreground">
                        Click to upload or drag and drop
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        CSV with columns: First Name, Last Name
                      </p>
                    </label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    The CSV can have a header row. Usernames and passwords will be generated automatically.
                  </p>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setBulkImportDialogOpen(false)}>
                    Cancel
                  </Button>
                </DialogFooter>
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>

      {students.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Users className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No students yet</h3>
            <p className="text-muted-foreground text-center mb-4">
              Create managed student accounts to get started.
              <br />
              Students will be able to sign in with their username and password.
            </p>
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Student
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {students.map((student) => (
            <Card key={student.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg">
                      {getDisplayName(student)}
                    </CardTitle>
                    <CardDescription>
                      Username: <span className="font-mono">{student.username}</span>
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelectedStudent(student);
                        setEnrollDialogOpen(true);
                      }}
                    >
                      <BookOpen className="h-4 w-4 mr-2" />
                      Enroll
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleResetPassword(student)}
                    >
                      <Key className="h-4 w-4 mr-2" />
                      Reset Password
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="destructive" size="sm">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Student Account</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will permanently delete the student account and all
                            associated data including submissions and grades. This
                            action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => handleDeleteStudent(student)}
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </CardHeader>
              {student.enrollments.length > 0 && (
                <CardContent className="pt-0">
                  <div className="flex flex-wrap gap-2">
                    {student.enrollments.map((enrollment) => (
                      <Badge
                        key={enrollment.id}
                        variant="secondary"
                        className="flex items-center gap-1"
                      >
                        {enrollment.course_name}
                        <button
                          onClick={() =>
                            handleUnenrollStudent(student.id, enrollment.course_id)
                          }
                          className="ml-1 hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Password Reset Dialog */}
      <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Password Reset</DialogTitle>
            <DialogDescription>
              The password for {selectedStudent?.username} has been reset.
              Share this new password with the student.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="flex items-center gap-2 p-3 bg-muted rounded-md">
              <span className="font-mono text-lg flex-1">{temporaryPassword}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyToClipboard(temporaryPassword || "")}
              >
                {copied ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              This password will not be shown again. Make sure to save it.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => setPasswordDialogOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Enroll Student Dialog */}
      <Dialog open={enrollDialogOpen} onOpenChange={setEnrollDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enroll in Course</DialogTitle>
            <DialogDescription>
              Select a course to enroll {selectedStudent?.username} in.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Select value={selectedCourseId} onValueChange={setSelectedCourseId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a course..." />
              </SelectTrigger>
              <SelectContent>
                {courses
                  .filter(
                    (course) =>
                      !selectedStudent?.enrollments.some(
                        (e) => e.course_id === course.id
                      )
                  )
                  .map((course) => (
                    <SelectItem key={course.id} value={course.id}>
                      {course.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {courses.filter(
              (course) =>
                !selectedStudent?.enrollments.some((e) => e.course_id === course.id)
            ).length === 0 && (
              <p className="text-sm text-muted-foreground mt-2">
                This student is already enrolled in all your courses.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEnrollDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleEnrollStudent}
              disabled={!selectedCourseId}
            >
              Enroll
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ManagedStudentsPage;
