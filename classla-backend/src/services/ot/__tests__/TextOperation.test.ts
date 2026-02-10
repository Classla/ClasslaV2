import { TextOperation, Component } from '../TextOperation';

// ---------------------------------------------------------------------------
// Helpers for the fuzz tests
// ---------------------------------------------------------------------------

/** Generate a random string of length `n` from a small alphabet. */
function randomString(n: number): string {
  const chars = 'abcdefghij';
  let s = '';
  for (let i = 0; i < n; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

/** Generate a random operation that applies to a document of length `docLen`. */
function randomOperation(docLen: number): TextOperation {
  const op = new TextOperation();
  let remaining = docLen;
  while (remaining > 0) {
    const roll = Math.random();
    if (roll < 0.4) {
      // retain
      const n = Math.min(1 + Math.floor(Math.random() * 5), remaining);
      op.retain(n);
      remaining -= n;
    } else if (roll < 0.7) {
      // insert
      op.insert(randomString(1 + Math.floor(Math.random() * 5)));
    } else {
      // delete
      const n = Math.min(1 + Math.floor(Math.random() * 5), remaining);
      op.delete(n);
      remaining -= n;
    }
  }
  // Occasionally insert at the end
  if (Math.random() < 0.3) {
    op.insert(randomString(1 + Math.floor(Math.random() * 3)));
  }
  return op;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TextOperation', () => {
  // -----------------------------------------------------------------------
  // 1. Basic operations
  // -----------------------------------------------------------------------
  describe('basic operations', () => {
    it('retain(n) increments both baseLength and targetLength', () => {
      const op = new TextOperation();
      op.retain(5);
      expect(op.baseLength).toBe(5);
      expect(op.targetLength).toBe(5);
      expect(op.ops).toEqual([5]);
    });

    it('retain(0) is a no-op and adds no component', () => {
      const op = new TextOperation();
      op.retain(0);
      expect(op.ops).toEqual([]);
      expect(op.baseLength).toBe(0);
      expect(op.targetLength).toBe(0);
    });

    it('retain throws on negative input', () => {
      const op = new TextOperation();
      expect(() => op.retain(-1)).toThrow('retain expects a positive integer');
    });

    it('consecutive retains are merged', () => {
      const op = new TextOperation();
      op.retain(3).retain(4);
      expect(op.ops).toEqual([7]);
      expect(op.baseLength).toBe(7);
      expect(op.targetLength).toBe(7);
    });

    it('insert(str) increments targetLength only', () => {
      const op = new TextOperation();
      op.insert('hello');
      expect(op.baseLength).toBe(0);
      expect(op.targetLength).toBe(5);
      expect(op.ops).toEqual(['hello']);
    });

    it('insert("") is a no-op and adds no component', () => {
      const op = new TextOperation();
      op.insert('');
      expect(op.ops).toEqual([]);
    });

    it('consecutive inserts are merged', () => {
      const op = new TextOperation();
      op.insert('hel').insert('lo');
      expect(op.ops).toEqual(['hello']);
      expect(op.targetLength).toBe(5);
    });

    it('delete(n) increments baseLength only', () => {
      const op = new TextOperation();
      op.delete(3);
      expect(op.baseLength).toBe(3);
      expect(op.targetLength).toBe(0);
      expect(op.ops).toEqual([-3]);
    });

    it('delete(0) is a no-op and adds no component', () => {
      const op = new TextOperation();
      op.delete(0);
      expect(op.ops).toEqual([]);
    });

    it('delete throws on negative input', () => {
      const op = new TextOperation();
      expect(() => op.delete(-1)).toThrow('delete expects a positive integer');
    });

    it('consecutive deletes are merged', () => {
      const op = new TextOperation();
      op.delete(2).delete(3);
      expect(op.ops).toEqual([-5]);
      expect(op.baseLength).toBe(5);
    });

    it('insert before delete for canonical form', () => {
      const op = new TextOperation();
      op.delete(3).insert('abc');
      // The insert should be placed before the delete
      expect(op.ops).toEqual(['abc', -3]);
    });

    it('chaining works via fluent API', () => {
      const op = new TextOperation();
      const result = op.retain(2).insert('x').delete(1).retain(3);
      expect(result).toBe(op);
      expect(op.baseLength).toBe(6);
      expect(op.targetLength).toBe(6);
    });
  });

  // -----------------------------------------------------------------------
  // 2. apply()
  // -----------------------------------------------------------------------
  describe('apply()', () => {
    it('applies a retain-only operation (identity)', () => {
      const op = new TextOperation();
      op.retain(5);
      expect(op.apply('hello')).toBe('hello');
    });

    it('applies an insert at the beginning', () => {
      const op = new TextOperation();
      op.insert('abc').retain(3);
      expect(op.apply('xyz')).toBe('abcxyz');
    });

    it('applies an insert in the middle', () => {
      const op = new TextOperation();
      op.retain(2).insert('--').retain(3);
      expect(op.apply('hello')).toBe('he--llo');
    });

    it('applies an insert at the end', () => {
      const op = new TextOperation();
      op.retain(5).insert('!');
      expect(op.apply('hello')).toBe('hello!');
    });

    it('applies a delete at the beginning', () => {
      const op = new TextOperation();
      op.delete(2).retain(3);
      expect(op.apply('hello')).toBe('llo');
    });

    it('applies a delete in the middle', () => {
      const op = new TextOperation();
      op.retain(1).delete(3).retain(1);
      expect(op.apply('hello')).toBe('ho');
    });

    it('applies a delete at the end', () => {
      const op = new TextOperation();
      op.retain(3).delete(2);
      expect(op.apply('hello')).toBe('hel');
    });

    it('applies a combined insert and delete (replacement)', () => {
      const op = new TextOperation();
      op.retain(1).delete(3).insert('ELL').retain(1);
      expect(op.apply('hello')).toBe('hELLo');
    });

    it('applies delete-all then insert (full replacement)', () => {
      const op = new TextOperation();
      op.delete(5).insert('world');
      expect(op.apply('hello')).toBe('world');
    });

    it('applies a pure insert to an empty string', () => {
      const op = new TextOperation();
      op.insert('hello');
      expect(op.apply('')).toBe('hello');
    });

    it('applies a pure delete to remove entire string', () => {
      const op = new TextOperation();
      op.delete(5);
      expect(op.apply('hello')).toBe('');
    });

    it('throws when document length does not match baseLength', () => {
      const op = new TextOperation();
      op.retain(10);
      expect(() => op.apply('short')).toThrow('Cannot apply operation');
    });

    it('throws when doc is too long', () => {
      const op = new TextOperation();
      op.retain(3);
      expect(() => op.apply('toolong')).toThrow('Cannot apply operation');
    });
  });

  // -----------------------------------------------------------------------
  // 3. isNoop()
  // -----------------------------------------------------------------------
  describe('isNoop()', () => {
    it('returns true for an empty operation', () => {
      const op = new TextOperation();
      expect(op.isNoop()).toBe(true);
    });

    it('returns true for a retain-only operation', () => {
      const op = new TextOperation();
      op.retain(10);
      expect(op.isNoop()).toBe(true);
    });

    it('returns false when there is an insert', () => {
      const op = new TextOperation();
      op.retain(3).insert('x').retain(2);
      expect(op.isNoop()).toBe(false);
    });

    it('returns false when there is a delete', () => {
      const op = new TextOperation();
      op.retain(2).delete(1).retain(2);
      expect(op.isNoop()).toBe(false);
    });

    it('returns false for insert-only operation', () => {
      const op = new TextOperation();
      op.insert('abc');
      expect(op.isNoop()).toBe(false);
    });

    it('returns false for delete-only operation', () => {
      const op = new TextOperation();
      op.delete(3);
      expect(op.isNoop()).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 4. Serialization: toJSON() / fromJSON()
  // -----------------------------------------------------------------------
  describe('toJSON() / fromJSON()', () => {
    it('roundtrips a retain-only operation', () => {
      const op = new TextOperation();
      op.retain(5);
      const json = op.toJSON();
      const restored = TextOperation.fromJSON(json);
      expect(restored.ops).toEqual(op.ops);
      expect(restored.baseLength).toBe(op.baseLength);
      expect(restored.targetLength).toBe(op.targetLength);
    });

    it('roundtrips an operation with all three component types', () => {
      const op = new TextOperation();
      op.retain(3).insert('abc').delete(2).retain(4);
      const json = op.toJSON();
      expect(json).toEqual([3, 'abc', -2, 4]);
      const restored = TextOperation.fromJSON(json);
      expect(restored.ops).toEqual(op.ops);
      expect(restored.baseLength).toBe(op.baseLength);
      expect(restored.targetLength).toBe(op.targetLength);
    });

    it('roundtrips an empty operation', () => {
      const op = new TextOperation();
      const json = op.toJSON();
      expect(json).toEqual([]);
      const restored = TextOperation.fromJSON(json);
      expect(restored.ops).toEqual([]);
      expect(restored.baseLength).toBe(0);
      expect(restored.targetLength).toBe(0);
    });

    it('roundtrips a pure insert', () => {
      const op = new TextOperation();
      op.insert('hello world');
      const restored = TextOperation.fromJSON(op.toJSON());
      expect(restored.apply('')).toBe('hello world');
    });

    it('produces the same apply() result after roundtrip', () => {
      const op = new TextOperation();
      op.retain(2).insert('XX').delete(1).retain(2);
      const doc = 'abcde';
      const restored = TextOperation.fromJSON(op.toJSON());
      expect(restored.apply(doc)).toBe(op.apply(doc));
    });

    it('throws on invalid component type in fromJSON', () => {
      expect(() => TextOperation.fromJSON([true as any])).toThrow('Invalid operation component');
      expect(() => TextOperation.fromJSON([null as any])).toThrow('Invalid operation component');
    });
  });

  // -----------------------------------------------------------------------
  // 5. compose()
  // -----------------------------------------------------------------------
  describe('compose()', () => {
    it('compose(a, b).apply(doc) === b.apply(a.apply(doc)) for simple insert then delete', () => {
      const doc = 'hello';
      const a = new TextOperation();
      a.retain(5).insert(' world');
      const b = new TextOperation();
      b.retain(11).delete(0); // noop on the result
      b.retain(0); // explicit noop
      // Actually create a meaningful b
      const b2 = new TextOperation();
      b2.delete(5).retain(6); // delete "hello", keep " world"

      const composed = TextOperation.compose(a, b2);
      expect(composed.apply(doc)).toBe(b2.apply(a.apply(doc)));
    });

    it('composes retain-only operations', () => {
      const doc = 'abcdef';
      const a = new TextOperation();
      a.retain(6);
      const b = new TextOperation();
      b.retain(6);
      const composed = TextOperation.compose(a, b);
      expect(composed.apply(doc)).toBe(doc);
      expect(composed.isNoop()).toBe(true);
    });

    it('composes an insert followed by a delete of the inserted text', () => {
      const doc = 'abc';
      const a = new TextOperation();
      a.retain(1).insert('XY').retain(2);
      // a.apply(doc) = "aXYbc" (length 5)
      const b = new TextOperation();
      b.retain(1).delete(2).retain(2);
      // b.apply("aXYbc") = "abc"
      const composed = TextOperation.compose(a, b);
      expect(composed.apply(doc)).toBe('abc');
    });

    it('compose of two inserts at same position', () => {
      const doc = '';
      const a = new TextOperation();
      a.insert('hello');
      const b = new TextOperation();
      b.retain(5).insert(' world');
      const composed = TextOperation.compose(a, b);
      expect(composed.apply(doc)).toBe('hello world');
    });

    it('compose of delete-all then insert', () => {
      const doc = 'abc';
      const a = new TextOperation();
      a.delete(3);
      // a.apply(doc) = ""
      const b = new TextOperation();
      b.insert('xyz');
      const composed = TextOperation.compose(a, b);
      expect(composed.apply(doc)).toBe('xyz');
    });

    it('compose throws when targetLength of a !== baseLength of b', () => {
      const a = new TextOperation();
      a.retain(5);
      const b = new TextOperation();
      b.retain(3);
      expect(() => TextOperation.compose(a, b)).toThrow(
        'compose: a.targetLength (5) !== b.baseLength (3)'
      );
    });

    it('composes multiple mixed operations correctly', () => {
      const doc = 'abcdefgh';
      // a: retain 2, insert "XX", delete 3, retain 3
      // "ab" + "XX" + skip "cde" + "fgh" = "abXXfgh" (length 7)
      const a = new TextOperation();
      a.retain(2).insert('XX').delete(3).retain(3);
      expect(a.apply(doc)).toBe('abXXfgh');

      // b: delete 2, retain 3, insert "YY", retain 2
      // skip "ab" + "XXf" + "YY" + "gh" = "XXfYYgh" (length 7)
      const b = new TextOperation();
      b.delete(2).retain(3).insert('YY').retain(2);
      expect(b.apply('abXXfgh')).toBe('XXfYYgh');

      const composed = TextOperation.compose(a, b);
      expect(composed.apply(doc)).toBe('XXfYYgh');
    });

    it('compose property holds: compose(a,b).apply(doc) === b.apply(a.apply(doc))', () => {
      const doc = 'The quick brown fox';
      const a = new TextOperation();
      a.retain(4).delete(5).insert('slow').retain(10);
      // "The slow brown fox"
      const b = new TextOperation();
      b.retain(9).delete(5).insert('red').retain(4);
      // "The slow red fox"
      const composed = TextOperation.compose(a, b);
      const expected = b.apply(a.apply(doc));
      expect(composed.apply(doc)).toBe(expected);
    });
  });

  // -----------------------------------------------------------------------
  // 6. transform()
  // -----------------------------------------------------------------------
  describe('transform()', () => {
    it('transform of two identity operations is two identity operations', () => {
      const doc = 'hello';
      const a = new TextOperation();
      a.retain(5);
      const b = new TextOperation();
      b.retain(5);
      const [aPrime, bPrime] = TextOperation.transform(a, b);
      expect(aPrime.apply(b.apply(doc))).toBe(bPrime.apply(a.apply(doc)));
      expect(aPrime.isNoop()).toBe(true);
      expect(bPrime.isNoop()).toBe(true);
    });

    it('convergence: inserts at different positions', () => {
      const doc = 'hello';
      // a inserts at position 1
      const a = new TextOperation();
      a.retain(1).insert('A').retain(4);
      // b inserts at position 4
      const b = new TextOperation();
      b.retain(4).insert('B').retain(1);

      const [aPrime, bPrime] = TextOperation.transform(a, b);
      const resultA = aPrime.apply(b.apply(doc));
      const resultB = bPrime.apply(a.apply(doc));
      expect(resultA).toBe(resultB);
    });

    it('convergence: inserts at the same position (a has priority)', () => {
      const doc = 'abc';
      const a = new TextOperation();
      a.retain(1).insert('X').retain(2);
      const b = new TextOperation();
      b.retain(1).insert('Y').retain(2);

      const [aPrime, bPrime] = TextOperation.transform(a, b);
      const resultA = aPrime.apply(b.apply(doc));
      const resultB = bPrime.apply(a.apply(doc));
      expect(resultA).toBe(resultB);
      // a has priority, so X should come before Y
      expect(resultA).toBe('aXYbc');
    });

    it('convergence: one inserts, the other deletes', () => {
      const doc = 'abcdef';
      // a inserts "X" at position 3
      const a = new TextOperation();
      a.retain(3).insert('X').retain(3);
      // b deletes chars 2-4 ("cde")
      const b = new TextOperation();
      b.retain(2).delete(3).retain(1);

      const [aPrime, bPrime] = TextOperation.transform(a, b);
      const resultA = aPrime.apply(b.apply(doc));
      const resultB = bPrime.apply(a.apply(doc));
      expect(resultA).toBe(resultB);
    });

    it('convergence: both delete the same region', () => {
      const doc = 'abcdef';
      const a = new TextOperation();
      a.retain(1).delete(3).retain(2);
      const b = new TextOperation();
      b.retain(1).delete(3).retain(2);

      const [aPrime, bPrime] = TextOperation.transform(a, b);
      const resultA = aPrime.apply(b.apply(doc));
      const resultB = bPrime.apply(a.apply(doc));
      expect(resultA).toBe(resultB);
      expect(resultA).toBe('aef');
    });

    it('convergence: overlapping deletes', () => {
      const doc = 'abcdef';
      // a deletes positions 1-3 ("bcd")
      const a = new TextOperation();
      a.retain(1).delete(3).retain(2);
      // b deletes positions 2-5 ("cdef")
      const b = new TextOperation();
      b.retain(2).delete(4);

      const [aPrime, bPrime] = TextOperation.transform(a, b);
      const resultA = aPrime.apply(b.apply(doc));
      const resultB = bPrime.apply(a.apply(doc));
      expect(resultA).toBe(resultB);
      expect(resultA).toBe('a');
    });

    it('convergence: one replaces, the other inserts nearby', () => {
      const doc = 'hello world';
      // a: replace "world" with "earth"
      const a = new TextOperation();
      a.retain(6).delete(5).insert('earth');
      // b: insert "beautiful " before "world"
      const b = new TextOperation();
      b.retain(6).insert('beautiful ').retain(5);

      const [aPrime, bPrime] = TextOperation.transform(a, b);
      const resultA = aPrime.apply(b.apply(doc));
      const resultB = bPrime.apply(a.apply(doc));
      expect(resultA).toBe(resultB);
    });

    it('throws when baseLength does not match', () => {
      const a = new TextOperation();
      a.retain(5);
      const b = new TextOperation();
      b.retain(3);
      expect(() => TextOperation.transform(a, b)).toThrow(
        'transform: a.baseLength (5) !== b.baseLength (3)'
      );
    });

    it('transform on empty document with two inserts converges', () => {
      const doc = '';
      const a = new TextOperation();
      a.insert('hello');
      const b = new TextOperation();
      b.insert('world');

      const [aPrime, bPrime] = TextOperation.transform(a, b);
      const resultA = aPrime.apply(b.apply(doc));
      const resultB = bPrime.apply(a.apply(doc));
      expect(resultA).toBe(resultB);
    });

    it('transform where a deletes everything and b inserts at start', () => {
      const doc = 'abc';
      const a = new TextOperation();
      a.delete(3);
      const b = new TextOperation();
      b.insert('X').retain(3);

      const [aPrime, bPrime] = TextOperation.transform(a, b);
      const resultA = aPrime.apply(b.apply(doc));
      const resultB = bPrime.apply(a.apply(doc));
      expect(resultA).toBe(resultB);
    });
  });

  // -----------------------------------------------------------------------
  // 7. Edge cases
  // -----------------------------------------------------------------------
  describe('edge cases', () => {
    it('empty operation applied to empty string returns empty string', () => {
      const op = new TextOperation();
      expect(op.apply('')).toBe('');
    });

    it('empty operation is a noop', () => {
      const op = new TextOperation();
      expect(op.isNoop()).toBe(true);
      expect(op.baseLength).toBe(0);
      expect(op.targetLength).toBe(0);
    });

    it('compose with identity operations', () => {
      const doc = 'abc';
      const a = new TextOperation();
      a.retain(3);
      const b = new TextOperation();
      b.retain(1).insert('X').retain(2);
      const composed = TextOperation.compose(a, b);
      expect(composed.apply(doc)).toBe(b.apply(a.apply(doc)));
    });

    it('transform with both identity operations on non-empty doc', () => {
      const doc = 'test';
      const a = new TextOperation();
      a.retain(4);
      const b = new TextOperation();
      b.retain(4);
      const [aPrime, bPrime] = TextOperation.transform(a, b);
      expect(aPrime.apply(b.apply(doc))).toBe(doc);
    });

    it('operation on single character string', () => {
      const op = new TextOperation();
      op.delete(1).insert('Y');
      expect(op.apply('X')).toBe('Y');
    });

    it('multiple inserts and deletes compose correctly', () => {
      const doc = 'ab';
      const a = new TextOperation();
      a.insert('X').retain(2).insert('Y');
      // a.apply(doc) = "XabY" (length 4)
      const b = new TextOperation();
      b.retain(1).delete(2).retain(1);
      // b.apply("XabY") = "XY"
      const composed = TextOperation.compose(a, b);
      expect(composed.apply(doc)).toBe('XY');
    });

    it('fromJSON with only inserts', () => {
      const restored = TextOperation.fromJSON(['abc', 'def']);
      expect(restored.baseLength).toBe(0);
      expect(restored.targetLength).toBe(6);
      expect(restored.apply('')).toBe('abcdef');
    });

    it('fromJSON with only deletes', () => {
      const restored = TextOperation.fromJSON([-3]);
      expect(restored.baseLength).toBe(3);
      expect(restored.targetLength).toBe(0);
      expect(restored.apply('abc')).toBe('');
    });

    it('insert followed by insert merges when preceded by delete', () => {
      // Verify the canonical form: insert, then delete
      const op = new TextOperation();
      op.delete(2).insert('a').insert('b');
      // The two inserts should be merged, and placed before the delete
      expect(op.ops).toEqual(['ab', -2]);
    });

    it('large retain values work correctly', () => {
      const doc = 'a'.repeat(10000);
      const op = new TextOperation();
      op.retain(5000).insert('X').retain(5000);
      const result = op.apply(doc);
      expect(result.length).toBe(10001);
      expect(result[5000]).toBe('X');
    });
  });

  // -----------------------------------------------------------------------
  // 8. Fuzz test: random operations verify convergence property
  // -----------------------------------------------------------------------
  describe('fuzz tests', () => {
    it('compose property: compose(a,b).apply(doc) === b.apply(a.apply(doc))', () => {
      const iterations = 200;
      for (let i = 0; i < iterations; i++) {
        const docLen = Math.floor(Math.random() * 20) + 1;
        const doc = randomString(docLen);

        const a = randomOperation(docLen);
        const afterA = a.apply(doc);
        const b = randomOperation(afterA.length);

        const composed = TextOperation.compose(a, b);
        const viaCompose = composed.apply(doc);
        const viaSequential = b.apply(afterA);
        expect(viaCompose).toBe(viaSequential);
      }
    });

    it('transform convergence: aPrime.apply(b.apply(doc)) === bPrime.apply(a.apply(doc))', () => {
      const iterations = 200;
      for (let i = 0; i < iterations; i++) {
        const docLen = Math.floor(Math.random() * 20) + 1;
        const doc = randomString(docLen);

        const a = randomOperation(docLen);
        const b = randomOperation(docLen);

        const [aPrime, bPrime] = TextOperation.transform(a, b);
        const resultA = aPrime.apply(b.apply(doc));
        const resultB = bPrime.apply(a.apply(doc));
        expect(resultA).toBe(resultB);
      }
    });

    it('toJSON/fromJSON roundtrip preserves behavior', () => {
      const iterations = 100;
      for (let i = 0; i < iterations; i++) {
        const docLen = Math.floor(Math.random() * 20);
        const doc = randomString(docLen);
        const op = randomOperation(docLen);

        const restored = TextOperation.fromJSON(op.toJSON());
        expect(restored.apply(doc)).toBe(op.apply(doc));
        expect(restored.baseLength).toBe(op.baseLength);
        expect(restored.targetLength).toBe(op.targetLength);
      }
    });

    it('compose + transform combined: transform of composed ops converges', () => {
      const iterations = 100;
      for (let i = 0; i < iterations; i++) {
        const docLen = Math.floor(Math.random() * 15) + 1;
        const doc = randomString(docLen);

        // Create two concurrent operations
        const a = randomOperation(docLen);
        const b = randomOperation(docLen);

        // Transform them
        const [aPrime, bPrime] = TextOperation.transform(a, b);

        // Verify convergence
        const resultA = aPrime.apply(b.apply(doc));
        const resultB = bPrime.apply(a.apply(doc));
        expect(resultA).toBe(resultB);

        // Also verify that composed paths work
        const composedAB = TextOperation.compose(b, aPrime);
        const composedBA = TextOperation.compose(a, bPrime);
        expect(composedAB.apply(doc)).toBe(resultA);
        expect(composedBA.apply(doc)).toBe(resultB);
      }
    });

    it('transform on empty documents with random inserts converges', () => {
      for (let i = 0; i < 50; i++) {
        const doc = '';
        const a = new TextOperation();
        a.insert(randomString(1 + Math.floor(Math.random() * 10)));
        const b = new TextOperation();
        b.insert(randomString(1 + Math.floor(Math.random() * 10)));

        const [aPrime, bPrime] = TextOperation.transform(a, b);
        const resultA = aPrime.apply(b.apply(doc));
        const resultB = bPrime.apply(a.apply(doc));
        expect(resultA).toBe(resultB);
      }
    });
  });
});
