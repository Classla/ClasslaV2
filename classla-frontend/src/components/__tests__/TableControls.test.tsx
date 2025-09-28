import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import AssignmentEditor from "../AssignmentEditor";
import { Assignment } from "../../types";

// Mock the hooks
vi.mock("../../hooks/use-toast", () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

vi.mock("../../hooks/useVirtualScrolling", () => ({
  useAssignmentOptimization: () => ({
    shouldOptimize: false,
  }),
  usePerformanceMonitoring: () => ({
    measureRenderTime: (fn: () => void) => fn(),
    updateMCQCount: vi.fn(),
  }),
}));

vi.mock("../../lib/api", () => ({
  apiClient: {
    updateAssignment: vi.fn().mockResolvedValue({}),
  },
}));

const mockAssignment: Assignment = {
  id: "test-assignment",
  title: "Test Assignment",
  content: JSON.stringify({
    type: "doc",
    content: [
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableHeader",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Header 1" }],
                  },
                ],
              },
              {
                type: "tableHeader",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Header 2" }],
                  },
                ],
              },
            ],
          },
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Cell 1" }],
                  },
                ],
              },
              {
                type: "tableCell",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Cell 2" }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  }),
  courseId: "test-course",
  moduleId: "test-module",
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("Table Controls", () => {
  const mockOnAssignmentUpdated = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render table controls when hovering over a table", async () => {
    render(
      <AssignmentEditor
        assignment={mockAssignment}
        onAssignmentUpdated={mockOnAssignmentUpdated}
        isReadOnly={false}
      />
    );

    // Wait for the editor to load
    await screen.findByRole("textbox");

    // Find the table element
    const table = document.querySelector("table");
    expect(table).toBeInTheDocument();

    // Simulate mouse move over the table (which triggers the hover logic)
    if (table) {
      fireEvent.mouseMove(table);

      // Wait a bit for the throttled mouse move to process
      await new Promise((resolve) => setTimeout(resolve, 50));

      // The table controls should appear (though they might be styled to be invisible initially)
      // We can check if the controls exist in the DOM
      const tableControls = document.querySelector(".table-controls");
      expect(tableControls).toBeInTheDocument();
    }
  });

  it("should show context menu on right click in table cell", async () => {
    render(
      <AssignmentEditor
        assignment={mockAssignment}
        onAssignmentUpdated={mockOnAssignmentUpdated}
        isReadOnly={false}
      />
    );

    // Wait for the editor to load
    await screen.findByRole("textbox");

    // Find a table cell
    const tableCell = document.querySelector("td");
    expect(tableCell).toBeInTheDocument();

    if (tableCell) {
      // Right click on the table cell
      fireEvent.contextMenu(tableCell);

      // Check if context menu appears
      const contextMenu = document.querySelector(".table-context-menu");
      expect(contextMenu).toBeInTheDocument();

      // Check for some menu items
      expect(screen.getByText("Add row above")).toBeInTheDocument();
      expect(screen.getByText("Add column before")).toBeInTheDocument();
      expect(screen.getByText("Merge cells")).toBeInTheDocument();
    }
  });
});
