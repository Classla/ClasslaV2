import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { CheckCircle, XCircle, Clock, Users, Loader2 } from "lucide-react";
import { Card } from "../components/ui/card";
import { joinLinksService, UseJoinLinkResponse } from "../services/joinLinks";
import { useAuth } from "../contexts/AuthContext";
import { apiClient } from "../lib/api";

type ProcessingStep =
  | "validating"
  | "enrolling"
  | "verifying"
  | "complete"
  | "error";

const JoinLinkPage: React.FC = () => {
  const { linkId } = useParams<{ linkId: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [currentStep, setCurrentStep] = useState<ProcessingStep>("validating");
  const [result, setResult] = useState<UseJoinLinkResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isExpired, setIsExpired] = useState(false);
  const [processingMessage, setProcessingMessage] = useState(
    "Validating join link..."
  );

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      // Redirect to sign in with return URL
      navigate(
        `/signin?returnUrl=${encodeURIComponent(window.location.pathname)}`
      );
      return;
    }

    if (!linkId) {
      setError("Invalid join link");
      setCurrentStep("error");
      return;
    }

    processJoinLink();
  }, [linkId, user, authLoading, navigate]);

  const processJoinLink = async () => {
    if (!linkId || !user) return;

    try {
      // Step 1: Validate and use the join link
      setCurrentStep("validating");
      setProcessingMessage("Validating join link...");

      const response = await joinLinksService.useJoinLink(linkId);

      // Step 2: Verify enrollment was created
      setCurrentStep("verifying");
      setProcessingMessage("Verifying enrollment...");

      // Wait a moment to ensure database consistency
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Verify the user is now enrolled in the course
      try {
        const userCourses = await apiClient.getUserCourses(user.id);
        const enrolledCourse = userCourses.data.find(
          (course: any) => course.slug === response.course_slug
        );

        if (!enrolledCourse) {
          console.warn(
            "Course not found in user's enrolled courses, but join was successful"
          );
          // Don't fail here - the join was successful according to the API
        }
      } catch (verificationError) {
        console.warn(
          "Could not verify enrollment, but join was successful:",
          verificationError
        );
        // Don't fail here - the join was successful according to the API
      }

      // Step 3: Success
      setCurrentStep("complete");
      setResult(response);
      setProcessingMessage("Successfully enrolled! Redirecting...");

      // Redirect after showing success message
      setTimeout(() => {
        navigate(`/course/${response.course_slug}`);
      }, 2000);
    } catch (err: any) {
      console.error("Join link error:", err);
      setCurrentStep("error");

      if (err.statusCode === 410) {
        setIsExpired(true);
      } else if (err.statusCode === 409) {
        // User is already enrolled
        const errorDetails = err.details || {};
        if (errorDetails.course_slug) {
          setResult({
            message: "You are already enrolled in this course",
            course_name: errorDetails.course_name,
            course_slug: errorDetails.course_slug,
            section_slug: errorDetails.section_slug,
          });
          setCurrentStep("complete");
          setTimeout(() => {
            navigate(`/course/${errorDetails.course_slug}`);
          }, 2000);
        } else {
          setError("You are already enrolled in this course");
        }
      } else {
        setError(err.message || "Failed to join course");
      }
    }
  };

  const handleGoToCourse = () => {
    if (result) {
      navigate(`/course/${result.course_slug}`);
    }
  };

  const handleGoToDashboard = () => {
    navigate("/dashboard");
  };

  if (
    authLoading ||
    currentStep === "validating" ||
    currentStep === "enrolling" ||
    currentStep === "verifying"
  ) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Card className="p-8 max-w-md w-full mx-4">
          <div className="text-center space-y-4">
            <div className="flex justify-center">
              <Loader2 className="w-12 h-12 text-purple-600 animate-spin" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900">
              Processing Join Link
            </h2>
            <p className="text-gray-600">{processingMessage}</p>

            {/* Progress indicator */}
            <div className="space-y-2">
              <div className="flex justify-center space-x-2">
                <div
                  className={`w-2 h-2 rounded-full ${
                    currentStep === "validating"
                      ? "bg-purple-600 animate-pulse"
                      : ["enrolling", "verifying", "complete"].includes(
                          currentStep
                        )
                      ? "bg-green-500"
                      : "bg-gray-300"
                  }`}
                />
                <div
                  className={`w-2 h-2 rounded-full ${
                    currentStep === "enrolling"
                      ? "bg-purple-600 animate-pulse"
                      : ["verifying", "complete"].includes(currentStep)
                      ? "bg-green-500"
                      : "bg-gray-300"
                  }`}
                />
                <div
                  className={`w-2 h-2 rounded-full ${
                    currentStep === "verifying"
                      ? "bg-purple-600 animate-pulse"
                      : currentStep === "complete"
                      ? "bg-green-500"
                      : "bg-gray-300"
                  }`}
                />
              </div>
              <p className="text-xs text-gray-500">
                {currentStep === "validating" && "Validating link..."}
                {currentStep === "enrolling" && "Creating enrollment..."}
                {currentStep === "verifying" && "Verifying enrollment..."}
              </p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  if (isExpired) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Card className="p-8 max-w-md w-full mx-4">
          <div className="text-center space-y-4">
            <div className="flex justify-center">
              <Clock className="w-16 h-16 text-orange-500" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Link Expired</h1>
            <p className="text-gray-600">
              This join link has expired. Please contact your instructor for a
              new link or the course join code.
            </p>
            <button
              onClick={handleGoToDashboard}
              className="w-full py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
            >
              Go to Dashboard
            </button>
          </div>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Card className="p-8 max-w-md w-full mx-4">
          <div className="text-center space-y-4">
            <div className="flex justify-center">
              <XCircle className="w-16 h-16 text-red-500" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">
              Unable to Join Course
            </h1>
            <p className="text-gray-600">{error}</p>
            <div className="space-y-2">
              <button
                onClick={() => {
                  setError(null);
                  setCurrentStep("validating");
                  processJoinLink();
                }}
                className="w-full py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
              >
                Try Again
              </button>
              <button
                onClick={handleGoToDashboard}
                className="w-full py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Go to Dashboard
              </button>
              {error.includes("already enrolled") && result && (
                <button
                  onClick={handleGoToCourse}
                  className="w-full py-2 border border-purple-600 text-purple-600 rounded-lg hover:bg-purple-50 transition-colors"
                >
                  Go to Course
                </button>
              )}
            </div>
          </div>
        </Card>
      </div>
    );
  }

  if (currentStep === "complete" && result) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Card className="p-8 max-w-md w-full mx-4">
          <div className="text-center space-y-4">
            <div className="flex justify-center">
              <CheckCircle className="w-16 h-16 text-green-500" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">
              {result.message.includes("already enrolled")
                ? "Already Enrolled!"
                : "Successfully Joined!"}
            </h1>
            <div className="space-y-2">
              <p className="text-gray-600">
                {result.message.includes("already enrolled")
                  ? `You are already enrolled in`
                  : `You have been enrolled in`}{" "}
                <strong>{result.course_name}</strong>
                {result.section_slug && (
                  <span> (Section: {result.section_slug})</span>
                )}
              </p>
              <div className="flex items-center justify-center space-x-2 text-sm text-gray-500">
                <Users className="w-4 h-4" />
                <span>Enrolled as Student</span>
              </div>
              <p className="text-sm text-gray-500 mt-2">
                Redirecting to course in 2 seconds...
              </p>
            </div>
            <div className="space-y-2 pt-4">
              <button
                onClick={handleGoToCourse}
                className="w-full py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
              >
                Go to Course
              </button>
              <button
                onClick={handleGoToDashboard}
                className="w-full py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Go to Dashboard
              </button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return null;
};

export default JoinLinkPage;
