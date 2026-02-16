import React from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog";
import { Badge } from "../../ui/badge";

interface TestResult {
  testId: string;
  testName: string;
  passed: boolean;
  points: number;
  pointsEarned: number;
  output: string;
  error: string | null;
}

interface AutograderTestResultsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  results: TestResult[];
  totalPoints: number;
  pointsEarned: number;
}

const AutograderTestResultsModal: React.FC<AutograderTestResultsModalProps> = ({
  open,
  onOpenChange,
  results,
  totalPoints,
  pointsEarned,
}) => {
  const passedCount = results.filter((r) => r.passed).length;
  const totalCount = results.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Test Results</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {/* Summary */}
          <div className="bg-muted rounded-lg p-4 border">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Tests Passed</p>
                  <p className="text-2xl font-bold">
                    {passedCount}/{totalCount}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Points Earned</p>
                  <p className="text-2xl font-bold">
                    {pointsEarned}/{totalPoints}
                  </p>
                </div>
              </div>
              <Badge
                variant={passedCount === totalCount ? "default" : "destructive"}
                className="text-lg px-4 py-2"
              >
                {passedCount === totalCount ? "All Passed" : "Some Failed"}
              </Badge>
            </div>
          </div>

          {/* Test Results */}
          <div className="space-y-3">
            {results.map((result) => (
              <div
                key={result.testId}
                className={`border rounded-lg p-4 ${
                  result.passed
                    ? "bg-green-50 border-green-200"
                    : "bg-red-50 border-red-200"
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {result.passed ? (
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                    ) : (
                      <XCircle className="h-5 w-5 text-red-600" />
                    )}
                    <h4 className="font-medium text-foreground">
                      {result.testName}
                    </h4>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-foreground">
                      {result.pointsEarned}/{result.points} points
                    </p>
                    <Badge
                      variant={result.passed ? "default" : "destructive"}
                      className="mt-1"
                    >
                      {result.passed ? "Passed" : "Failed"}
                    </Badge>
                  </div>
                </div>

                {/* Output */}
                {(result.output || result.error) && (
                  <div className="mt-3 pt-3 border-t border-border">
                    {result.error && (
                      <div className="mb-2">
                        <p className="text-xs font-medium text-red-700 mb-1">
                          Error:
                        </p>
                        <pre className="text-xs bg-red-100 p-2 rounded border border-red-200 font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">
                          {result.error}
                        </pre>
                      </div>
                    )}
                    {result.output && (
                      <div>
                        <p className="text-xs font-medium text-foreground mb-1">
                          Output:
                        </p>
                        <pre className="text-xs bg-card p-2 rounded border font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">
                          {result.output}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AutograderTestResultsModal;

