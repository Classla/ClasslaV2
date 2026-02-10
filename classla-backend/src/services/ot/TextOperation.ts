/**
 * TextOperation - Core OT data structure
 *
 * Three component types:
 * - number > 0: retain N characters
 * - string: insert string
 * - number < 0: delete |N| characters
 */

export type Component = number | string;

export class TextOperation {
  ops: Component[] = [];
  baseLength: number = 0;
  targetLength: number = 0;

  /**
   * Retain N characters (skip over them unchanged)
   */
  retain(n: number): this {
    if (n === 0) return this;
    if (n < 0) throw new Error("retain expects a positive integer");
    this.baseLength += n;
    this.targetLength += n;
    // Merge with last op if also a retain
    if (this.ops.length > 0 && typeof this.ops[this.ops.length - 1] === "number" && (this.ops[this.ops.length - 1] as number) > 0) {
      (this.ops[this.ops.length - 1] as number) += n;
    } else {
      this.ops.push(n);
    }
    return this;
  }

  /**
   * Insert a string at the current position
   */
  insert(str: string): this {
    if (str === "") return this;
    this.targetLength += str.length;
    // Merge with last op if also an insert
    if (this.ops.length > 0 && typeof this.ops[this.ops.length - 1] === "string") {
      (this.ops[this.ops.length - 1] as string) += str;
    } else if (this.ops.length > 0 && typeof this.ops[this.ops.length - 1] === "number" && (this.ops[this.ops.length - 1] as number) < 0) {
      // Insert before delete for canonical form
      if (this.ops.length > 1 && typeof this.ops[this.ops.length - 2] === "string") {
        (this.ops[this.ops.length - 2] as string) += str;
      } else {
        this.ops.splice(this.ops.length - 1, 0, str);
      }
    } else {
      this.ops.push(str);
    }
    return this;
  }

  /**
   * Delete n characters at the current position
   * @param n positive number of characters to delete
   */
  delete(n: number): this {
    if (n === 0) return this;
    if (n < 0) throw new Error("delete expects a positive integer");
    this.baseLength += n;
    // Store as negative number internally
    const negN = -n;
    if (this.ops.length > 0 && typeof this.ops[this.ops.length - 1] === "number" && (this.ops[this.ops.length - 1] as number) < 0) {
      (this.ops[this.ops.length - 1] as number) += negN;
    } else {
      this.ops.push(negN);
    }
    return this;
  }

  /**
   * Apply this operation to a document string
   */
  apply(doc: string): string {
    if (doc.length !== this.baseLength) {
      throw new Error(
        `Cannot apply operation: expected doc length ${this.baseLength}, got ${doc.length}`
      );
    }
    const parts: string[] = [];
    let index = 0;
    for (const op of this.ops) {
      if (typeof op === "number") {
        if (op > 0) {
          // retain
          parts.push(doc.slice(index, index + op));
          index += op;
        } else {
          // delete
          index += -op;
        }
      } else {
        // insert
        parts.push(op);
      }
    }
    return parts.join("");
  }

  /**
   * Check if this operation is a no-op
   */
  isNoop(): boolean {
    for (const op of this.ops) {
      if (typeof op === "string") return false;
      if (typeof op === "number" && op < 0) return false;
    }
    return true;
  }

  /**
   * Serialize to JSON
   */
  toJSON(): Component[] {
    return this.ops;
  }

  /**
   * Deserialize from JSON
   */
  static fromJSON(ops: Component[]): TextOperation {
    const o = new TextOperation();
    for (const op of ops) {
      if (typeof op === "number") {
        if (op > 0) {
          o.retain(op);
        } else {
          o.delete(-op);
        }
      } else if (typeof op === "string") {
        o.insert(op);
      } else {
        throw new Error(`Invalid operation component: ${JSON.stringify(op)}`);
      }
    }
    return o;
  }

  /**
   * Compose two operations: produces C such that C.apply(doc) === b.apply(a.apply(doc))
   */
  static compose(a: TextOperation, b: TextOperation): TextOperation {
    if (a.targetLength !== b.baseLength) {
      throw new Error(
        `compose: a.targetLength (${a.targetLength}) !== b.baseLength (${b.baseLength})`
      );
    }
    const result = new TextOperation();
    const aOps = a.ops.slice();
    const bOps = b.ops.slice();
    let ai = 0;
    let bi = 0;
    let aOp: Component | undefined = aOps[ai++];
    let bOp: Component | undefined = bOps[bi++];

    while (aOp !== undefined || bOp !== undefined) {
      // Handle deletes from a
      if (typeof aOp === "number" && aOp < 0) {
        result.delete(-aOp);
        aOp = aOps[ai++];
        continue;
      }
      // Handle inserts from b
      if (typeof bOp === "string") {
        result.insert(bOp);
        bOp = bOps[bi++];
        continue;
      }

      if (aOp === undefined || bOp === undefined) {
        throw new Error("compose: operation mismatch - ran out of components");
      }

      // Both are retains
      if (typeof aOp === "number" && aOp > 0 && typeof bOp === "number" && bOp > 0) {
        if (aOp > bOp) {
          result.retain(bOp);
          aOp = aOp - bOp;
          bOp = bOps[bi++];
        } else if (aOp < bOp) {
          result.retain(aOp);
          bOp = bOp - aOp;
          aOp = aOps[ai++];
        } else {
          result.retain(aOp);
          aOp = aOps[ai++];
          bOp = bOps[bi++];
        }
      }
      // a is insert, b is delete
      else if (typeof aOp === "string" && typeof bOp === "number" && bOp < 0) {
        const aLen: number = aOp.length;
        const bLen: number = -bOp;
        if (aLen > bLen) {
          aOp = aOp.slice(bLen);
          bOp = bOps[bi++];
        } else if (aLen < bLen) {
          aOp = aOps[ai++];
          bOp = -(bLen - aLen);
        } else {
          aOp = aOps[ai++];
          bOp = bOps[bi++];
        }
      }
      // a is insert, b is retain
      else if (typeof aOp === "string" && typeof bOp === "number" && bOp > 0) {
        const aLen: number = aOp.length;
        if (aLen > bOp) {
          result.insert(aOp.slice(0, bOp));
          aOp = aOp.slice(bOp);
          bOp = bOps[bi++];
        } else if (aLen < bOp) {
          result.insert(aOp);
          bOp = bOp - aLen;
          aOp = aOps[ai++];
        } else {
          result.insert(aOp);
          aOp = aOps[ai++];
          bOp = bOps[bi++];
        }
      }
      // a is retain, b is delete
      else if (typeof aOp === "number" && aOp > 0 && typeof bOp === "number" && bOp < 0) {
        const bLen: number = -bOp;
        if (aOp > bLen) {
          result.delete(bLen);
          aOp = aOp - bLen;
          bOp = bOps[bi++];
        } else if (aOp < bLen) {
          result.delete(aOp);
          bOp = -(bLen - aOp);
          aOp = aOps[ai++];
        } else {
          result.delete(aOp);
          aOp = aOps[ai++];
          bOp = bOps[bi++];
        }
      } else {
        throw new Error(`compose: unhandled case: aOp=${JSON.stringify(aOp)}, bOp=${JSON.stringify(bOp)}`);
      }
    }

    return result;
  }

  /**
   * Transform two concurrent operations.
   * Returns [a', b'] such that:
   *   a'.apply(b.apply(doc)) === b'.apply(a.apply(doc))
   *
   * a has priority (tie-breaking: a's insert goes first)
   */
  static transform(a: TextOperation, b: TextOperation): [TextOperation, TextOperation] {
    if (a.baseLength !== b.baseLength) {
      throw new Error(
        `transform: a.baseLength (${a.baseLength}) !== b.baseLength (${b.baseLength})`
      );
    }
    const aPrime = new TextOperation();
    const bPrime = new TextOperation();
    const aOps = a.ops.slice();
    const bOps = b.ops.slice();
    let ai = 0;
    let bi = 0;
    let aOp: Component | undefined = aOps[ai++];
    let bOp: Component | undefined = bOps[bi++];

    while (aOp !== undefined || bOp !== undefined) {
      // a inserts: a' inserts, b' retains over the insertion
      if (typeof aOp === "string") {
        aPrime.insert(aOp);
        bPrime.retain(aOp.length);
        aOp = aOps[ai++];
        continue;
      }
      // b inserts: b' inserts, a' retains over the insertion
      if (typeof bOp === "string") {
        bPrime.insert(bOp);
        aPrime.retain(bOp.length);
        bOp = bOps[bi++];
        continue;
      }

      if (aOp === undefined || bOp === undefined) {
        throw new Error("transform: operation mismatch - ran out of components");
      }

      // Both retain
      if (typeof aOp === "number" && aOp > 0 && typeof bOp === "number" && bOp > 0) {
        const minLen = Math.min(aOp, bOp);
        aPrime.retain(minLen);
        bPrime.retain(minLen);
        if (aOp > bOp) {
          aOp = aOp - bOp;
          bOp = bOps[bi++];
        } else if (aOp < bOp) {
          bOp = bOp - aOp;
          aOp = aOps[ai++];
        } else {
          aOp = aOps[ai++];
          bOp = bOps[bi++];
        }
      }
      // a deletes, b deletes
      else if (typeof aOp === "number" && aOp < 0 && typeof bOp === "number" && bOp < 0) {
        const aLen: number = -aOp;
        const bLen: number = -bOp;
        if (aLen > bLen) {
          aOp = -(aLen - bLen);
          bOp = bOps[bi++];
        } else if (aLen < bLen) {
          bOp = -(bLen - aLen);
          aOp = aOps[ai++];
        } else {
          aOp = aOps[ai++];
          bOp = bOps[bi++];
        }
      }
      // a deletes, b retains
      else if (typeof aOp === "number" && aOp < 0 && typeof bOp === "number" && bOp > 0) {
        const aLen: number = -aOp;
        const minLen = Math.min(aLen, bOp);
        aPrime.delete(minLen);
        if (aLen > bOp) {
          aOp = -(aLen - bOp);
          bOp = bOps[bi++];
        } else if (aLen < bOp) {
          bOp = bOp - aLen;
          aOp = aOps[ai++];
        } else {
          aOp = aOps[ai++];
          bOp = bOps[bi++];
        }
      }
      // a retains, b deletes
      else if (typeof aOp === "number" && aOp > 0 && typeof bOp === "number" && bOp < 0) {
        const bLen: number = -bOp;
        const minLen = Math.min(aOp, bLen);
        bPrime.delete(minLen);
        if (aOp > bLen) {
          aOp = aOp - bLen;
          bOp = bOps[bi++];
        } else if (aOp < bLen) {
          bOp = -(bLen - aOp);
          aOp = aOps[ai++];
        } else {
          aOp = aOps[ai++];
          bOp = bOps[bi++];
        }
      } else {
        throw new Error(`transform: unhandled case: aOp=${JSON.stringify(aOp)}, bOp=${JSON.stringify(bOp)}`);
      }
    }

    return [aPrime, bPrime];
  }
}
