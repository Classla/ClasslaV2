/**
 * Deterministic randomization utilities for assignment content
 */

/**
 * Simple hash function to convert string to number
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Seeded random number generator (Linear Congruential Generator)
 * This ensures deterministic "random" numbers based on a seed
 */
class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed % 2147483647;
    if (this.seed <= 0) this.seed += 2147483646;
  }

  /**
   * Generate next random number between 0 and 1
   */
  next(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }

  /**
   * Generate random integer between min (inclusive) and max (exclusive)
   */
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min)) + min;
  }
}

/**
 * Fisher-Yates shuffle algorithm with seeded random
 */
function shuffleArray<T>(array: T[], random: SeededRandom): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = random.nextInt(0, i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Create a deterministic seed based on student ID and assignment ID
 */
export function createDeterministicSeed(
  studentId: string,
  assignmentId: string
): number {
  const combined = `${studentId}-${assignmentId}`;
  return hashString(combined);
}

/**
 * Randomize array order deterministically based on student and assignment
 */
export function randomizeArrayOrder<T>(
  array: T[],
  studentId: string,
  assignmentId: string
): T[] {
  if (array.length <= 1) return array;

  const seed = createDeterministicSeed(studentId, assignmentId);
  const random = new SeededRandom(seed);
  return shuffleArray(array, random);
}

/**
 * Extract MCQ blocks from TipTap content and their positions
 */
export interface MCQBlockWithPosition {
  block: any;
  path: number[]; // Path to the block in the content tree
}

/**
 * Recursively find all MCQ blocks in TipTap content
 */
export function extractMCQBlocks(content: any): MCQBlockWithPosition[] {
  const blocks: MCQBlockWithPosition[] = [];

  function traverse(node: any, path: number[] = []): void {
    if (node && typeof node === "object") {
      if (node.type === "mcqBlock") {
        blocks.push({ block: node, path: [...path] });
      }

      if (node.content && Array.isArray(node.content)) {
        node.content.forEach((child: any, index: number) => {
          traverse(child, [...path, index]);
        });
      }
    }
  }

  traverse(content);
  return blocks;
}

/**
 * Randomize MCQ blocks in TipTap content
 */
export function randomizeMCQBlocks(
  content: any,
  studentId: string,
  assignmentId: string
): any {
  if (!content || typeof content !== "object") {
    return content;
  }

  // Deep clone the content to avoid mutations
  const clonedContent = JSON.parse(JSON.stringify(content));

  // Extract all MCQ blocks
  const mcqBlocks = extractMCQBlocks(clonedContent);

  if (mcqBlocks.length <= 1) {
    return clonedContent; // No need to randomize if 0 or 1 blocks
  }

  // Create randomized order of MCQ blocks
  const randomizedBlocks = randomizeArrayOrder(
    mcqBlocks.map((item) => item.block),
    studentId,
    assignmentId
  );

  // Replace MCQ blocks in the content with randomized versions
  mcqBlocks.forEach((item, index) => {
    const { path } = item;
    const randomizedBlock = randomizedBlocks[index];

    // Navigate to the block's position and replace it
    let current = clonedContent;
    for (let i = 0; i < path.length - 1; i++) {
      if (current.content && Array.isArray(current.content)) {
        current = current.content[path[i]];
      }
    }

    // Replace the block at the final position
    if (current.content && Array.isArray(current.content)) {
      const finalIndex = path[path.length - 1];
      current.content[finalIndex] = randomizedBlock;
    }
  });

  return clonedContent;
}
