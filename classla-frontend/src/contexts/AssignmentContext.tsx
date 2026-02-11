import React, { createContext, useContext, ReactNode } from 'react';

interface AssignmentContextType {
  courseId: string | null;
  assignmentId: string | null;
  previewMode: boolean;
}

const AssignmentContext = createContext<AssignmentContextType | undefined>(undefined);

export const useAssignmentContext = () => {
  const context = useContext(AssignmentContext);
  // Return undefined values if not within provider (graceful fallback)
  if (!context) {
    return { courseId: null, assignmentId: null, previewMode: false };
  }
  return context;
};

interface AssignmentProviderProps {
  children: ReactNode;
  courseId: string | null;
  assignmentId: string | null;
  previewMode?: boolean;
}

export const AssignmentProvider: React.FC<AssignmentProviderProps> = ({
  children,
  courseId,
  assignmentId,
  previewMode = false,
}) => {
  const value: AssignmentContextType = {
    courseId,
    assignmentId,
    previewMode,
  };

  return (
    <AssignmentContext.Provider value={value}>
      {children}
    </AssignmentContext.Provider>
  );
};
