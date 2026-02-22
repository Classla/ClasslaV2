import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient } from "../../../lib/api";
import { useToast } from "../../../hooks/use-toast";
import { Card } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { CheckCircle, Clock, FileText, Calendar } from "lucide-react";

interface Submission {
  id: string;
  assignment_id: string;
  student_id: string;
  status: string;
  grade: number | null;
  timestamp: string;
  created_at: string;
}

interface Assignment {
  id: string;
  name: string;
  course_id: string;
}

interface SubmissionsListProps {
  assignmentId: string;
  courseSlug: string;
}

const SubmissionsList: React.FC<SubmissionsListProps> = ({
  assignmentId,
  courseSlug,
}) => {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch assignment details
        const assignmentResponse = await apiClient.getAssignmentForStudent(
          assignmentId
        );
        setAssignment(assignmentResponse.data);

        // Fetch submissions
        const submissionsResponse = await apiClient.getSubmissionsByAssignment(
          assignmentId
        );
        setSubmissions(submissionsResponse.data);
      } catch (error: any) {
        console.error("Failed to fetch submissions:", error);
        toast({
          title: "Error loading submissions",
          description: error.message || "Failed to load submission history",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [assignmentId, toast]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "submitted":
        return <CheckCircle className="w-5 h-5 text-blue-600" />;
      case "graded":
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case "in-progress":
        return <Clock className="w-5 h-5 text-yellow-600" />;
      default:
        return <FileText className="w-5 h-5 text-muted-foreground" />;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case "submitted":
        return "Submitted";
      case "graded":
        return "Graded";
      case "in-progress":
        return "In Progress";
      default:
        return status;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "submitted":
        return "text-blue-600 bg-blue-50 dark:bg-blue-950/30";
      case "graded":
        return "text-green-600 bg-green-50 dark:bg-green-950/30";
      case "in-progress":
        return "text-yellow-600 bg-yellow-50 dark:bg-yellow-950/30";
      default:
        return "text-muted-foreground bg-muted";
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
        <span className="ml-3 text-muted-foreground">Loading submissions...</span>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-6">
        <Button
          variant="outline"
          onClick={() =>
            navigate(`/course/${courseSlug}/assignment/${assignmentId}`)
          }
          className="mb-4"
        >
          ← Back to Assignment
        </Button>
        <h1 className="text-3xl font-bold text-foreground mb-2">
          Submission History
        </h1>
        {assignment && (
          <p className="text-muted-foreground">
            Assignment: <span className="font-medium">{assignment.name}</span>
          </p>
        )}
      </div>

      {submissions.length === 0 ? (
        <Card className="p-8 text-center">
          <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">
            No Submissions Yet
          </h3>
          <p className="text-muted-foreground mb-4">
            You haven't submitted this assignment yet.
          </p>
          <Button
            onClick={() =>
              navigate(`/course/${courseSlug}/assignment/${assignmentId}`)
            }
            className="bg-purple-600 hover:bg-purple-700 dark:bg-purple-800 dark:hover:bg-purple-900 text-white"
          >
            Start Assignment
          </Button>
        </Card>
      ) : (
        <div className="space-y-4">
          {submissions.map((submission) => (
            <Card
              key={submission.id}
              className="p-6 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-4 flex-1">
                  <div className="mt-1">{getStatusIcon(submission.status)}</div>
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <span
                        className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(
                          submission.status
                        )}`}
                      >
                        {getStatusText(submission.status)}
                      </span>
                      {submission.grade !== null && (
                        <span className="text-lg font-semibold text-foreground">
                          Grade: {submission.grade}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Calendar className="w-4 h-4" />
                        <span>
                          Submitted: {formatDate(submission.timestamp)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    navigate(`/course/${courseSlug}/assignment/${assignmentId}`)
                  }
                >
                  View
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default SubmissionsList;
