/**
 * Basic Operational Transform for text editing
 * This is a simplified implementation for real-time collaborative editing
 */

export interface TextOperation {
  type: "insert" | "delete" | "retain";
  position?: number;
  length?: number;
  text?: string;
}

/**
 * Apply a text operation to a string
 */
export function applyOperation(text: string, operation: TextOperation): string {
  if (operation.type === "insert" && operation.position !== undefined && operation.text) {
    return (
      text.slice(0, operation.position) +
      operation.text +
      text.slice(operation.position)
    );
  }
  
  if (operation.type === "delete" && operation.position !== undefined && operation.length) {
    return (
      text.slice(0, operation.position) +
      text.slice(operation.position + operation.length)
    );
  }
  
  if (operation.type === "retain") {
    return text;
  }
  
  return text;
}

/**
 * Transform operation A against operation B
 * Returns the transformed operation A' that can be applied after B
 */
export function transformOperation(
  opA: TextOperation,
  opB: TextOperation,
  priority: "A" | "B" = "A"
): TextOperation {
  // If operations don't overlap, no transformation needed
  if (opA.position === undefined || opB.position === undefined) {
    return opA;
  }

  // If A is before B, no transformation needed
  if (opA.position < opB.position) {
    return opA;
  }

  // If A is after B, adjust position
  if (opA.position > opB.position) {
    if (opB.type === "insert" && opB.text) {
      return {
        ...opA,
        position: opA.position + opB.text.length,
      };
    }
    if (opB.type === "delete" && opB.length) {
      return {
        ...opA,
        position: Math.max(0, opA.position - opB.length),
      };
    }
  }

  // If operations are at the same position, use priority
  if (opA.position === opB.position) {
    if (priority === "A") {
      if (opB.type === "insert" && opB.text) {
        return {
          ...opA,
          position: opA.position + opB.text.length,
        };
      }
    } else {
      // Priority B - A's position stays the same
      return opA;
    }
  }

  return opA;
}

/**
 * Create an insert operation
 */
export function createInsertOperation(position: number, text: string): TextOperation {
  return {
    type: "insert",
    position,
    text,
  };
}

/**
 * Create a delete operation
 */
export function createDeleteOperation(position: number, length: number): TextOperation {
  return {
    type: "delete",
    position,
    length,
  };
}

/**
 * Create a retain operation (no-op)
 */
export function createRetainOperation(): TextOperation {
  return {
    type: "retain",
  };
}

/**
 * Compute the difference between two strings as operations
 * This is a simplified version - a full implementation would use proper diff algorithms
 */
export function computeOperations(oldText: string, newText: string): TextOperation[] {
  const operations: TextOperation[] = [];
  let i = 0;
  let j = 0;

  while (i < oldText.length || j < newText.length) {
    if (i < oldText.length && j < newText.length && oldText[i] === newText[j]) {
      i++;
      j++;
      continue;
    }

    // Insertion
    if (j < newText.length && (i >= oldText.length || oldText[i] !== newText[j])) {
      const insertStart = j;
      while (j < newText.length && (i >= oldText.length || oldText[i] !== newText[j])) {
        j++;
      }
      operations.push(createInsertOperation(insertStart, newText.slice(insertStart, j)));
    }

    // Deletion
    if (i < oldText.length && (j >= newText.length || oldText[i] !== newText[j])) {
      const deleteStart = i;
      while (i < oldText.length && (j >= newText.length || oldText[i] !== newText[j])) {
        i++;
      }
      operations.push(createDeleteOperation(deleteStart, i - deleteStart));
    }
  }

  return operations;
}

