import React, { createContext, useContext, ReactNode } from 'react';

interface AssignmentContextType {
  courseId: string | null;
  assignmentId: string | null;
  previewMode: boolean;
  studentId: string | null;
  snapshotBucketMap: Record<string, string> | null; // blockId -> snapshotBucketId
}

const AssignmentContext = createContext<AssignmentContextType | undefined>(undefined);

export const useAssignmentContext = () => {
  const context = useContext(AssignmentContext);
  // Return undefined values if not within provider (graceful fallback)
  if (!context) {
    return { courseId: null, assignmentId: null, previewMode: false, studentId: null, snapshotBucketMap: null };
  }
  return context;
};

interface AssignmentProviderProps {
  children: ReactNode;
  courseId: string | null;
  assignmentId: string | null;
  previewMode?: boolean;
  studentId?: string | null;
  snapshotBucketMap?: Record<string, string> | null;
}

export const AssignmentProvider: React.FC<AssignmentProviderProps> = ({
  children,
  courseId,
  assignmentId,
  previewMode = false,
  studentId = null,
  snapshotBucketMap = null,
}) => {
  const value: AssignmentContextType = {
    courseId,
    assignmentId,
    previewMode,
    studentId,
    snapshotBucketMap,
  };

  return (
    <AssignmentContext.Provider value={value}>
      {children}
    </AssignmentContext.Provider>
  );
};
