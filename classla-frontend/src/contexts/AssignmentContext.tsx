import React, { createContext, useContext, ReactNode } from 'react';

interface AssignmentContextType {
  courseId: string | null;
  assignmentId: string | null;
}

const AssignmentContext = createContext<AssignmentContextType | undefined>(undefined);

export const useAssignmentContext = () => {
  const context = useContext(AssignmentContext);
  // Return undefined values if not within provider (graceful fallback)
  if (!context) {
    return { courseId: null, assignmentId: null };
  }
  return context;
};

interface AssignmentProviderProps {
  children: ReactNode;
  courseId: string | null;
  assignmentId: string | null;
}

export const AssignmentProvider: React.FC<AssignmentProviderProps> = ({
  children,
  courseId,
  assignmentId
}) => {
  const value: AssignmentContextType = {
    courseId,
    assignmentId,
  };

  return (
    <AssignmentContext.Provider value={value}>
      {children}
    </AssignmentContext.Provider>
  );
};
