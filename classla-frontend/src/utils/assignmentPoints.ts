/**
 * Utility functions for calculating assignment points from MCQ blocks and rubrics
 */

import { RubricSchema } from "../types";

interface MCQBlockNode {
  type: string;
  attrs?: {
    mcqData?: {
      points?: number;
    };
  };
  content?: MCQBlockNode[];
}

/**
 * Calculate total points from rubric schema
 * Only includes non-negative, non-extra-credit items
 * @param rubricSchema - The rubric schema
 * @returns Total points from rubric
 */
export function calculateRubricPoints(
  rubricSchema: RubricSchema | null
): number {
  if (!rubricSchema) return 0;

  return rubricSchema.items.reduce((total, item) => {
    // Only count positive points that are not extra credit
    if (item.points > 0 && !item.isExtraCredit) {
      return total + item.points;
    }
    return total;
  }, 0);
}

/**
 * Calculate total points for an assignment by summing points from all MCQ blocks
 * @param content - The assignment content as a JSON string
 * @returns Total points from all MCQ blocks, or 0 if content is invalid
 */
export function calculateAssignmentPoints(
  content: string,
  rubricSchema?: RubricSchema | null
): number {
  try {
    // Parse the assignment content JSON
    const parsedContent: MCQBlockNode = JSON.parse(content);
    let totalPoints = 0;

    /**
     * Recursively traverse the document tree to find MCQ blocks
     */
    function traverse(node: MCQBlockNode): void {
      // Check if this is an MCQ block with point data
      if (node.type === "mcqBlock" && node.attrs?.mcqData) {
        const points = node.attrs.mcqData.points || 0;
        totalPoints += points;
      }

      // Recursively process child nodes
      if (node.content && Array.isArray(node.content)) {
        node.content.forEach(traverse);
      }
    }

    traverse(parsedContent);

    // Add rubric points if provided
    if (rubricSchema) {
      totalPoints += calculateRubricPoints(rubricSchema);
    }

    return totalPoints;
  } catch (error) {
    // Handle parsing errors gracefully
    console.error("Failed to calculate assignment points:", error);
    return 0;
  }
}
