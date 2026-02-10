import React, { useState } from "react";
import { Pencil, Trash2, ChevronDown, ChevronUp, Loader2, Sparkles } from "lucide-react";
import { Button } from "../../ui/button";
import { Badge } from "../../ui/badge";
import { TestCase } from "../../extensions/IDEBlock";

interface AutograderTestListProps {
  tests: TestCase[];
  onAddTest: () => void;
  onEditTest: (test: TestCase) => void;
  onDeleteTest: (testId: string) => void;
  onTestModelSolution?: () => void;
  onGenerateUnitTests?: () => void;
  isGeneratingUnitTests?: boolean;
}

const AutograderTestList: React.FC<AutograderTestListProps> = ({
  tests,
  onAddTest,
  onEditTest,
  onDeleteTest,
  onTestModelSolution,
  onGenerateUnitTests,
  isGeneratingUnitTests,
}) => {
  const [expandedTests, setExpandedTests] = useState<Set<string>>(new Set());

  const toggleExpanded = (testId: string) => {
    setExpandedTests((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(testId)) {
        newSet.delete(testId);
      } else {
        newSet.add(testId);
      }
      return newSet;
    });
  };

  const getTestTypeLabel = (type: TestCase["type"]): string => {
    switch (type) {
      case "inputOutput":
        return "Input Output";
      case "unitTest":
        return "Unit Test";
      case "manualGrading":
        return "Manual Grading";
      default:
        return type;
    }
  };

  const getTestTypeBadgeVariant = (type: TestCase["type"]): "default" | "secondary" | "outline" => {
    switch (type) {
      case "inputOutput":
        return "default";
      case "unitTest":
        return "secondary";
      case "manualGrading":
        return "outline";
      default:
        return "default";
    }
  };

  const totalPoints = tests.reduce((sum, test) => sum + test.points, 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-bold">Autograder</h3>
          <p className="text-sm text-gray-600">Total Points: {totalPoints}</p>
        </div>
        {onTestModelSolution && (
          <Button
            onClick={onTestModelSolution}
            className="bg-purple-600 hover:bg-purple-700 text-white"
            size="sm"
          >
            Test Model Solution
          </Button>
        )}
      </div>

      {/* Test Cases List */}
      <div className="space-y-3">
        {tests.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>No test cases yet. Add your first test case below.</p>
          </div>
        ) : (
          tests.map((test) => {
            const isExpanded = expandedTests.has(test.id);
            return (
              <div
                key={test.id}
                className="border border-gray-200 rounded-lg p-4 bg-white"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium text-gray-900">{test.name}</h4>
                      <Badge variant={getTestTypeBadgeVariant(test.type)}>
                        {getTestTypeLabel(test.type)}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-700">
                      {test.points} {test.points === 1 ? "Point" : "Points"}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => onEditTest(test)}
                      title="Edit test case"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => onDeleteTest(test.id)}
                      title="Delete test case"
                    >
                      <Trash2 className="h-4 w-4 text-red-600" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => toggleExpanded(test.id)}
                    >
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>

                {/* Expanded Content */}
                {isExpanded && (
                  <div className="mt-4 pt-4 border-t border-gray-200 space-y-3">
                    {test.type === "inputOutput" && (
                      <>
                        <div>
                          <p className="text-xs font-medium text-gray-700 mb-1">Input:</p>
                          <pre className="text-xs bg-gray-50 p-2 rounded border font-mono whitespace-pre-wrap">
                            {test.input || "(empty)"}
                          </pre>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-gray-700 mb-1">Expected Output:</p>
                          <pre className="text-xs bg-gray-50 p-2 rounded border font-mono whitespace-pre-wrap">
                            {test.expectedOutput || "(empty)"}
                          </pre>
                        </div>
                      </>
                    )}
                    {test.type === "unitTest" && (
                      <div>
                        <p className="text-xs font-medium text-gray-700 mb-1">Unit Test Code:</p>
                        <pre className="text-xs bg-gray-50 p-2 rounded border font-mono whitespace-pre-wrap max-h-64 overflow-y-auto">
                          {test.code || "(empty)"}
                        </pre>
                      </div>
                    )}
                    {test.type === "manualGrading" && (
                      <p className="text-xs text-gray-600">
                        This test case requires manual grading.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Add Test / Generate Buttons */}
      <div className="flex justify-center gap-2 pt-2">
        <Button
          onClick={onAddTest}
          className="bg-purple-600 hover:bg-purple-700 text-white"
        >
          + Add Test
        </Button>
        {onGenerateUnitTests && (
          <Button
            onClick={onGenerateUnitTests}
            disabled={isGeneratingUnitTests}
            variant="outline"
            className="border-purple-300 text-purple-700 hover:bg-purple-50 hover:border-purple-400"
          >
            {isGeneratingUnitTests ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4 mr-2" />
            )}
            {isGeneratingUnitTests ? "Generating..." : "Generate with AI"}
          </Button>
        )}
      </div>
    </div>
  );
};

export default AutograderTestList;

