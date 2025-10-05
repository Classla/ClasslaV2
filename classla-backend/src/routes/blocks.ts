import { Router, Request, Response } from "express";
import { supabase } from "../middleware/auth";
import { authenticateToken } from "../middleware/auth";
import { getCoursePermissions } from "../middleware/authorization";

const router = Router();

/**
 * MCQ Block Data Interface
 */
interface MCQOption {
  id: string;
  text: string;
  isCorrect: boolean;
}

interface MCQBlockData {
  id: string;
  question: string;
  options: MCQOption[];
  allowMultiple: boolean;
  points: number;
  explanation?: string;
}

/**
 * Autograding result interface
 */
interface AutogradeResult {
  blockId: string;
  isCorrect: boolean;
  pointsEarned: number;
  pointsPossible: number;
  feedback?: string;
}

/**
 * Extract MCQ blocks from assignment content
 */
const extractMCQBlocks = (content: string): Map<string, MCQBlockData> => {
  const blocks = new Map<string, MCQBlockData>();

  try {
    const parsedContent = JSON.parse(content);

    // Recursively find MCQ blocks in the JSON structure
    const findMCQBlocks = (node: any): void => {
      if (node && typeof node === "object") {
        if (node.type === "mcqBlock" && node.attrs?.mcqData) {
          const mcqData = node.attrs.mcqData as MCQBlockData;
          if (mcqData.id) {
            blocks.set(mcqData.id, mcqData);
          }
        }

        if (node.content && Array.isArray(node.content)) {
          for (const child of node.content) {
            findMCQBlocks(child);
          }
        }
      }
    };

    findMCQBlocks(parsedContent);
  } catch (error) {
    console.error(
      "Failed to parse assignment content for MCQ extraction:",
      error
    );
  }

  return blocks;
};

/**
 * Grade a single MCQ block
 */
const gradeMCQBlock = (
  blockData: MCQBlockData,
  studentAnswer: string[]
): AutogradeResult => {
  // Get correct option IDs
  const correctOptionIds = blockData.options
    .filter((opt) => opt.isCorrect)
    .map((opt) => opt.id)
    .sort();

  // Sort student answer for comparison
  const sortedStudentAnswer = [...studentAnswer].sort();

  // Check if answers match
  const isCorrect =
    correctOptionIds.length === sortedStudentAnswer.length &&
    correctOptionIds.every((id, index) => id === sortedStudentAnswer[index]);

  const pointsEarned = isCorrect ? blockData.points : 0;

  // Generate feedback
  let feedback = "";
  if (isCorrect) {
    feedback = "Correct!";
    if (blockData.explanation) {
      feedback += ` ${blockData.explanation}`;
    }
  } else {
    feedback = "Incorrect.";
    if (blockData.explanation) {
      feedback += ` ${blockData.explanation}`;
    }
  }

  return {
    blockId: blockData.id,
    isCorrect,
    pointsEarned,
    pointsPossible: blockData.points,
    feedback,
  };
};

/**
 * POST /blocks/autograde/:assignmentId
 * Autograde interactive blocks in a submission
 * Requirements: Autograding for MCQ blocks
 */
router.post(
  "/blocks/autograde/:assignmentId",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { assignmentId } = req.params;
      const { submissionValues } = req.body;
      const { id: userId, isAdmin } = req.user!;

      // Validate request body
      if (!submissionValues || typeof submissionValues !== "object") {
        res.status(400).json({
          error: {
            code: "INVALID_REQUEST",
            message: "submissionValues is required and must be an object",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Get the assignment
      const { data: assignment, error: assignmentError } = await supabase
        .from("assignments")
        .select("*")
        .eq("id", assignmentId)
        .single();

      if (assignmentError || !assignment) {
        res.status(404).json({
          error: {
            code: "ASSIGNMENT_NOT_FOUND",
            message: "Assignment not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Check course permissions
      const permissions = await getCoursePermissions(
        userId,
        assignment.course_id,
        isAdmin
      );

      if (!permissions.canRead) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: "Not authorized to access this assignment",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Extract MCQ blocks from assignment content
      const mcqBlocks = extractMCQBlocks(assignment.content);

      if (mcqBlocks.size === 0) {
        res.json({
          results: [],
          totalPointsEarned: 0,
          totalPointsPossible: 0,
          message: "No interactive blocks found in assignment",
        });
        return;
      }

      // Grade each submitted block
      const results: AutogradeResult[] = [];
      let totalPointsEarned = 0;
      let totalPointsPossible = 0;

      for (const [blockId, blockData] of mcqBlocks.entries()) {
        const studentAnswer = submissionValues[blockId];

        if (studentAnswer && Array.isArray(studentAnswer)) {
          const result = gradeMCQBlock(blockData, studentAnswer);
          results.push(result);
          totalPointsEarned += result.pointsEarned;
          totalPointsPossible += result.pointsPossible;
        } else {
          // Block not answered
          results.push({
            blockId,
            isCorrect: false,
            pointsEarned: 0,
            pointsPossible: blockData.points,
            feedback: "Not answered",
          });
          totalPointsPossible += blockData.points;
        }
      }

      res.json({
        results,
        totalPointsEarned,
        totalPointsPossible,
        percentage:
          totalPointsPossible > 0
            ? (totalPointsEarned / totalPointsPossible) * 100
            : 0,
      });
    } catch (error) {
      console.error("Error autograding blocks:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to autograde blocks",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * GET /blocks/extract/:assignmentId
 * Extract interactive blocks from an assignment (instructor only)
 * This endpoint returns the full block data including correct answers
 */
router.get(
  "/blocks/extract/:assignmentId",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { assignmentId } = req.params;
      const { id: userId, isAdmin } = req.user!;

      // Get the assignment
      const { data: assignment, error: assignmentError } = await supabase
        .from("assignments")
        .select("*")
        .eq("id", assignmentId)
        .single();

      if (assignmentError || !assignment) {
        res.status(404).json({
          error: {
            code: "ASSIGNMENT_NOT_FOUND",
            message: "Assignment not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Check permissions - only instructors/TAs can extract blocks with answers
      const permissions = await getCoursePermissions(
        userId,
        assignment.course_id,
        isAdmin
      );

      if (!permissions.canGrade && !permissions.canManage) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: "Not authorized to extract blocks from this assignment",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Extract MCQ blocks
      const mcqBlocks = extractMCQBlocks(assignment.content);

      res.json({
        blocks: Array.from(mcqBlocks.values()),
        count: mcqBlocks.size,
      });
    } catch (error) {
      console.error("Error extracting blocks:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to extract blocks",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

export default router;
