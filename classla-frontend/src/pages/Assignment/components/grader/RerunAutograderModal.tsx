import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { Assignment } from "../../../../types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "../../../../components/ui/dialog";
import { Button } from "../../../../components/ui/button";
import { apiClient } from "../../../../lib/api";
import { useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  CircleDot,
  Code,
} from "lucide-react";

// ─── Block extraction ──────────────────────────────────────────────────────────

interface GradeableBlock {
  id: string;
  type: "mcq" | "ide";
  label: string;
  points: number;
  testCount?: number;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").trim();
}

function extractGradeableBlocks(content: string): GradeableBlock[] {
  try {
    const doc = JSON.parse(content);
    const blocks: GradeableBlock[] = [];

    function traverse(node: any) {
      if (node.type === "mcqBlock" && node.attrs?.mcqData) {
        const d = node.attrs.mcqData;
        if (d.id && typeof d.points === "number") {
          const raw = typeof d.question === "string" ? d.question : "";
          const label = stripHtml(raw).slice(0, 72) || "MCQ Question";
          blocks.push({ id: d.id, type: "mcq", label, points: d.points });
        }
      }

      if (node.type === "ideBlock" && node.attrs?.ideData) {
        const d = node.attrs.ideData;
        const tests: any[] = d.autograder?.tests ?? [];
        const execTests = tests.filter((t) => t.type !== "manualGrading");
        if (d.id && execTests.length > 0) {
          const points = execTests.reduce(
            (s: number, t: any) => s + (typeof t.points === "number" ? t.points : 0),
            0
          );
          const rawLabel = d.title ?? d.name ?? d.description ?? "IDE Block";
          const label =
            typeof rawLabel === "string" ? rawLabel.slice(0, 72) : "IDE Block";
          blocks.push({
            id: d.id,
            type: "ide",
            label,
            points,
            testCount: execTests.length,
          });
        }
      }

      if (node.content) node.content.forEach(traverse);
    }

    traverse(doc);
    return blocks;
  } catch {
    return [];
  }
}

// ─── Types ─────────────────────────────────────────────────────────────────────

type RowStatus = "pending" | "running" | "done" | "error";

interface StudentRow {
  userId: string;
  firstName: string;
  lastName: string;
  submissionId: string;
  status: RowStatus;
  score?: number;
  totalPossible?: number;
  error?: string;
}

export interface StudentForRerun {
  userId: string;
  firstName: string;
  lastName: string;
  latestSubmission: { id: string; status: string } | null;
}

interface RerunAutograderModalProps {
  isOpen: boolean;
  onClose: () => void;
  assignment: Assignment;
  students: StudentForRerun[];
}

// ─── Component ─────────────────────────────────────────────────────────────────

export const RerunAutograderModal: React.FC<RerunAutograderModalProps> = ({
  isOpen,
  onClose,
  assignment,
  students,
}) => {
  const queryClient = useQueryClient();

  const blocks = useMemo(
    () => extractGradeableBlocks(assignment.content ?? ""),
    [assignment.content]
  );

  const eligibleStudents = useMemo(
    () =>
      students.filter(
        (s) =>
          s.latestSubmission?.status === "submitted" ||
          s.latestSubmission?.status === "graded"
      ),
    [students]
  );

  const [rows, setRows] = useState<StudentRow[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const cancelledRef = useRef(false);

  // Reset whenever the modal opens
  useEffect(() => {
    if (!isOpen) return;
    cancelledRef.current = false;
    setIsRunning(false);
    setIsDone(false);
    setRows(
      eligibleStudents.map((s) => ({
        userId: s.userId,
        firstName: s.firstName,
        lastName: s.lastName,
        submissionId: s.latestSubmission!.id,
        status: "pending",
      }))
    );
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const doneCount = rows.filter(
    (r) => r.status === "done" || r.status === "error"
  ).length;
  const errorCount = rows.filter((r) => r.status === "error").length;

  const handleRun = useCallback(async () => {
    if (isRunning || eligibleStudents.length === 0) return;

    cancelledRef.current = false;
    setIsRunning(true);
    setIsDone(false);

    // Snapshot eligible students at run start (immune to prop changes mid-run)
    const snapshot: StudentRow[] = eligibleStudents.map((s) => ({
      userId: s.userId,
      firstName: s.firstName,
      lastName: s.lastName,
      submissionId: s.latestSubmission!.id,
      status: "pending",
    }));
    setRows(snapshot);

    for (let i = 0; i < snapshot.length; i++) {
      if (cancelledRef.current) break;

      setRows((prev) =>
        prev.map((r, idx) => (idx === i ? { ...r, status: "running" } : r))
      );

      try {
        const res = await apiClient.runAndGradeSubmission(snapshot[i].submissionId);
        if (cancelledRef.current) break;
        const data = res.data;
        setRows((prev) =>
          prev.map((r, idx) =>
            idx === i
              ? {
                  ...r,
                  status: "done",
                  score: data.grader?.raw_assignment_score,
                  totalPossible: data.totalPossiblePoints,
                }
              : r
          )
        );
      } catch (err: any) {
        if (cancelledRef.current) break;
        setRows((prev) =>
          prev.map((r, idx) =>
            idx === i
              ? { ...r, status: "error", error: err.message ?? "Failed" }
              : r
          )
        );
      }
    }

    if (!cancelledRef.current) {
      setIsDone(true);
      setIsRunning(false);
      queryClient.invalidateQueries({
        queryKey: ["submissions", "with-students", assignment.id],
      });
    }
  }, [isRunning, eligibleStudents, assignment.id, queryClient]);

  const handleClose = useCallback(() => {
    if (isRunning) {
      cancelledRef.current = true;
      setIsRunning(false);
    }
    onClose();
  }, [isRunning, onClose]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-lg flex flex-col max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-primary" />
            Rerun All Autograders
          </DialogTitle>
          <DialogDescription>
            Starts a container, runs IDE tests against the student's submitted
            code, then scores all blocks. May take a few minutes.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 overflow-hidden flex-1 min-h-0">
          {/* ── Gradeable blocks list ── */}
          <div className="flex-shrink-0">
            <p className="text-sm font-medium text-foreground mb-2">
              Graded blocks&nbsp;
              <span className="text-muted-foreground font-normal">
                ({blocks.length})
              </span>
            </p>
            {blocks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No auto-gradeable blocks in this assignment.
              </p>
            ) : (
              <div className="space-y-1.5 max-h-44 overflow-y-auto pr-0.5">
                {blocks.map((block) => (
                  <div
                    key={block.id}
                    className="flex items-center gap-2.5 py-1.5 px-3 rounded-md bg-muted border border-border"
                  >
                    {block.type === "mcq" ? (
                      <CircleDot className="w-4 h-4 text-purple-500 flex-shrink-0" />
                    ) : (
                      <Code className="w-4 h-4 text-blue-500 flex-shrink-0" />
                    )}
                    <span className="text-sm text-foreground flex-1 truncate">
                      {block.label}
                    </span>
                    <span className="text-xs text-muted-foreground flex-shrink-0 whitespace-nowrap">
                      {block.points}pt
                      {block.type === "ide" && block.testCount
                        ? ` · ${block.testCount} test${block.testCount !== 1 ? "s" : ""}`
                        : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Student progress list ── */}
          <div className="flex flex-col min-h-0 flex-1">
            <div className="flex items-center justify-between mb-2 flex-shrink-0">
              <p className="text-sm font-medium text-foreground">
                Students&nbsp;
                <span className="text-muted-foreground font-normal">
                  ({eligibleStudents.length} submitted)
                </span>
              </p>
              {isRunning && (
                <span className="text-xs text-muted-foreground">
                  {doneCount}&thinsp;/&thinsp;{rows.length}
                </span>
              )}
              {isDone && rows.length > 0 && (
                <span
                  className={`text-xs font-medium ${
                    errorCount > 0 ? "text-amber-600" : "text-green-600"
                  }`}
                >
                  {errorCount > 0
                    ? `${doneCount - errorCount} done · ${errorCount} failed`
                    : `All ${doneCount} done`}
                </span>
              )}
            </div>

            {eligibleStudents.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No submitted students to regrade.
              </p>
            ) : (
              <div className="space-y-1 overflow-y-auto flex-1 pr-0.5">
                {rows.map((row) => (
                  <div
                    key={row.userId}
                    className="flex items-center gap-2.5 py-1.5 px-3 rounded-md border border-border"
                  >
                    {row.status === "pending" && (
                      <div className="w-4 h-4 rounded-full border-2 border-border flex-shrink-0" />
                    )}
                    {row.status === "running" && (
                      <Loader2 className="w-4 h-4 animate-spin text-primary flex-shrink-0" />
                    )}
                    {row.status === "done" && (
                      <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                    )}
                    {row.status === "error" && (
                      <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                    )}
                    <span className="text-sm text-foreground flex-1 truncate">
                      {row.lastName}, {row.firstName}
                    </span>
                    <span className="text-xs text-muted-foreground flex-shrink-0 whitespace-nowrap">
                      {row.status === "pending" && "Pending"}
                      {row.status === "running" && "Running…"}
                      {row.status === "done" &&
                        (row.score !== undefined
                          ? `${row.score}${
                              row.totalPossible !== undefined
                                ? ` / ${row.totalPossible}`
                                : ""
                            } pts`
                          : "Done")}
                      {row.status === "error" && (row.error ?? "Error")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 flex-shrink-0">
          <Button variant="outline" onClick={handleClose}>
            {isRunning ? "Cancel" : "Close"}
          </Button>
          <Button
            onClick={handleRun}
            disabled={
              isRunning ||
              blocks.length === 0 ||
              eligibleStudents.length === 0
            }
            className="bg-purple-600 hover:bg-purple-700 dark:bg-purple-800 dark:hover:bg-purple-900 text-white"
          >
            {isRunning ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Running…
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                {isDone ? "Run Again" : "Run All"}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
