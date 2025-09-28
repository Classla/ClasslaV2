import React from "react";
import { useLocation } from "react-router-dom";
import CourseSummaryPage from "./CourseSummaryPage";
import StudentsPage from "./StudentsPage";
import AssignmentPage from "./AssignmentPage";
import CourseSettingsPage from "./CourseSettingsPage";

interface CoursePageProps {
  course?: any;
  setCourse?: any;
  userRole?: any;
  isStudent?: boolean;
  isInstructor?: boolean;
  handleCopyJoinCode?: () => void;
  copied?: boolean;
}

const CoursePage: React.FC<CoursePageProps> = (props) => {
  const location = useLocation();
  const currentPage = location.pathname.split("/").pop() || "summary";

  const renderContent = () => {
    // Check if this is an assignment route
    const pathParts = location.pathname.split("/");
    if (pathParts.includes("assignment") && pathParts.length >= 5) {
      return <AssignmentPage {...props} />;
    }

    switch (currentPage) {
      case "summary":
        return <CourseSummaryPage {...props} />;
      case "students":
        return <StudentsPage {...props} />;
      case "grades":
        return (
          <div className="p-8 text-center text-gray-600">
            Grades coming soon...
          </div>
        );
      case "settings":
        return <CourseSettingsPage {...props} />;
      default:
        return <CourseSummaryPage {...props} />;
    }
  };

  return renderContent();
};

export default CoursePage;
