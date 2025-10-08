/**
 * Utility functions for calculating assignment points from MCQ blocks
 */

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
 * Calculate total points for an assignment by summing points from all MCQ blocks
 * @param content - The assignment content as a JSON string
 * @returns Total points from all MCQ blocks, or 0 if content is invalid
 */
export function calculateAssignmentPoints(content: string): number {
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
    return totalPoints;
  } catch (error) {
    // Handle parsing errors gracefully
    console.error("Failed to calculate assignment points:", error);
    return 0;
  }
}
