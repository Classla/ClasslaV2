/**
 * OTServer unit tests
 *
 * OTPersistence is fully mocked to prevent real Supabase/S3 access.
 */

// Mock the OTPersistence module before any imports
jest.mock("../OTPersistence", () => {
  const mockPersistence = {
    loadDocument: jest.fn(),
    saveDocument: jest.fn(),
    saveOperation: jest.fn(),
    getOperationsSince: jest.fn(),
    loadFileFromS3: jest.fn(),
    saveFileToS3: jest.fn(),
    compactOperations: jest.fn(),
    deleteDocument: jest.fn(),
  };
  return {
    OTPersistence: jest.fn(() => mockPersistence),
    __mockPersistence: mockPersistence,
  };
});

// Mock the logger to keep test output clean
jest.mock("../../../utils/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { OTServer, OTDocument } from "../OTServer";
import { TextOperation } from "../TextOperation";
import { OTPersistence } from "../OTPersistence";

// Retrieve the shared mock instance that every OTServer constructor will use
const { __mockPersistence: mockPersistence } = jest.requireMock("../OTPersistence");

// Typed aliases for convenience
const mockLoadDocument = mockPersistence.loadDocument as jest.Mock;
const mockSaveDocument = mockPersistence.saveDocument as jest.Mock;
const mockSaveOperation = mockPersistence.saveOperation as jest.Mock;
const mockGetOperationsSince = mockPersistence.getOperationsSince as jest.Mock;
const mockLoadFileFromS3 = mockPersistence.loadFileFromS3 as jest.Mock;
const mockSaveFileToS3 = mockPersistence.saveFileToS3 as jest.Mock;
const mockDeleteDocument = mockPersistence.deleteDocument as jest.Mock;

const BUCKET_INFO = { bucket_name: "test-bucket", region: "us-east-1" };
const BUCKET_ID = "bucket-123";
const FILE_PATH = "workspace/main.py";
const DOC_ID = OTServer.getDocumentId(BUCKET_ID, FILE_PATH);

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  // Default happy-path stubs
  mockSaveDocument.mockResolvedValue(undefined);
  mockSaveOperation.mockResolvedValue(undefined);
  mockSaveFileToS3.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create an OTServer with a document already loaded in memory at the given
 * content and revision. This avoids having to set up persistence mocks for
 * every test that only cares about receiveOperation / applyFullContent.
 */
async function serverWithDoc(
  content: string,
  revision: number
): Promise<OTServer> {
  mockLoadDocument.mockResolvedValueOnce(null);
  mockLoadFileFromS3.mockResolvedValueOnce(content);

  const server = new OTServer();
  const doc = await server.createDocument(BUCKET_ID, FILE_PATH, BUCKET_INFO);

  // Patch revision to desired value (createDocument starts at 0)
  (doc as any).revision = revision;
  (doc as any).content = content;

  jest.clearAllMocks();
  // Re-apply default stubs after clearing
  mockSaveDocument.mockResolvedValue(undefined);
  mockSaveOperation.mockResolvedValue(undefined);
  mockSaveFileToS3.mockResolvedValue(undefined);

  return server;
}

// ===========================================================================
// 1. receiveOperation at current revision
// ===========================================================================

describe("receiveOperation at current revision", () => {
  it("applies an insert operation and increments revision", async () => {
    const server = await serverWithDoc("hello", 0);

    // Client is at revision 0 (== server), inserts " world" at end
    const op = new TextOperation();
    op.retain(5);
    op.insert(" world");

    const result = await server.receiveOperation(DOC_ID, 0, op, "user-1");

    expect(result.revision).toBe(1);
    const doc = await server.getDocument(DOC_ID);
    expect(doc!.content).toBe("hello world");
  });

  it("applies a delete operation", async () => {
    const server = await serverWithDoc("hello world", 3);

    const op = new TextOperation();
    op.retain(5);
    op.delete(6); // delete " world"

    const result = await server.receiveOperation(DOC_ID, 3, op, "user-1");

    expect(result.revision).toBe(4);
    const doc = await server.getDocument(DOC_ID);
    expect(doc!.content).toBe("hello");
  });

  it("persists the operation to the database", async () => {
    const server = await serverWithDoc("abc", 0);

    const op = new TextOperation();
    op.retain(3);
    op.insert("d");

    await server.receiveOperation(DOC_ID, 0, op, "author-42");

    expect(mockSaveOperation).toHaveBeenCalledTimes(1);
    expect(mockSaveOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        document_id: DOC_ID,
        revision: 1,
        author_id: "author-42",
      })
    );
  });

  it("throws when client revision is ahead of server", async () => {
    const server = await serverWithDoc("x", 0);

    const op = new TextOperation();
    op.retain(1);

    await expect(
      server.receiveOperation(DOC_ID, 5, op, "user-1")
    ).rejects.toThrow(/Client revision 5 is ahead of server revision 0/);
  });

  it("throws when document is not in memory", async () => {
    const server = new OTServer();

    const op = new TextOperation();
    op.insert("x");

    await expect(
      server.receiveOperation("nonexistent:doc", 0, op, "user-1")
    ).rejects.toThrow(/Document not found/);
  });
});

// ===========================================================================
// 2. receiveOperation behind revision (transform path)
// ===========================================================================

describe("receiveOperation behind revision", () => {
  it("transforms client op against missed operations", async () => {
    // Server document: "hello" at revision 1
    // The missed operation (rev 1) was: insert "X" at position 0  ("hello" -> "Xhello")
    const server = await serverWithDoc("Xhello", 1);

    // The missed op stored in DB: insert "X" at position 0 of "hello"
    const missedOp = new TextOperation();
    missedOp.insert("X");
    missedOp.retain(5);

    mockGetOperationsSince.mockResolvedValueOnce([
      {
        document_id: DOC_ID,
        revision: 1,
        author_id: "other-user",
        operations: missedOp.toJSON(),
      },
    ]);

    // Client thinks document is still "hello" (rev 0), inserts "!" at end
    const clientOp = new TextOperation();
    clientOp.retain(5);
    clientOp.insert("!");

    const result = await server.receiveOperation(DOC_ID, 0, clientOp, "user-1");

    expect(result.revision).toBe(2);
    // After transform: client op should now retain 6 chars (accounting for "X") then insert "!"
    const doc = await server.getDocument(DOC_ID);
    expect(doc!.content).toBe("Xhello!");
  });

  it("transforms against multiple missed operations", async () => {
    // Start: "ab" -> rev1: "Xab" -> rev2: "XYab" -> current content "XYab" at rev 2
    const server = await serverWithDoc("XYab", 2);

    const missedOp1 = new TextOperation();
    missedOp1.insert("X");
    missedOp1.retain(2);

    const missedOp2 = new TextOperation();
    missedOp2.retain(1); // retain "X"
    missedOp2.insert("Y");
    missedOp2.retain(2); // retain "ab"

    mockGetOperationsSince.mockResolvedValueOnce([
      { document_id: DOC_ID, revision: 1, author_id: "u1", operations: missedOp1.toJSON() },
      { document_id: DOC_ID, revision: 2, author_id: "u2", operations: missedOp2.toJSON() },
    ]);

    // Client at rev 0 on "ab", wants to insert "!" at the end
    const clientOp = new TextOperation();
    clientOp.retain(2);
    clientOp.insert("!");

    const result = await server.receiveOperation(DOC_ID, 0, clientOp, "user-3");

    expect(result.revision).toBe(3);
    const doc = await server.getDocument(DOC_ID);
    expect(doc!.content).toBe("XYab!");
  });
});

// ===========================================================================
// 3. Concurrent operations convergence
// ===========================================================================

describe("concurrent operations convergence", () => {
  it("two clients submit concurrent ops and document converges", async () => {
    // Starting document: "abc" at revision 0
    const server = await serverWithDoc("abc", 0);

    // Client A (at rev 0): insert "X" at position 0 -> "Xabc"
    const opA = new TextOperation();
    opA.insert("X");
    opA.retain(3);

    // Client B (at rev 0): insert "Y" at position 3 -> "abcY"
    const opB = new TextOperation();
    opB.retain(3);
    opB.insert("Y");

    // Server processes A first
    const resultA = await server.receiveOperation(DOC_ID, 0, opA, "clientA");
    expect(resultA.revision).toBe(1);

    // Server content is now "Xabc"
    let doc = await server.getDocument(DOC_ID);
    expect(doc!.content).toBe("Xabc");

    // Now B arrives, also at rev 0. Server must transform B against A.
    mockGetOperationsSince.mockResolvedValueOnce([
      {
        document_id: DOC_ID,
        revision: 1,
        author_id: "clientA",
        operations: opA.toJSON(),
      },
    ]);

    const resultB = await server.receiveOperation(DOC_ID, 0, opB, "clientB");
    expect(resultB.revision).toBe(2);

    // Final document should have both insertions: "XabcY"
    doc = await server.getDocument(DOC_ID);
    expect(doc!.content).toBe("XabcY");
  });

  it("concurrent delete and insert converge correctly", async () => {
    // Starting document: "abcdef" at revision 0
    const server = await serverWithDoc("abcdef", 0);

    // Client A: delete "bc" (positions 1-3)
    const opA = new TextOperation();
    opA.retain(1);
    opA.delete(2); // delete "bc"
    opA.retain(3);

    // Client B: insert "X" at position 3 (between "c" and "d")
    const opB = new TextOperation();
    opB.retain(3);
    opB.insert("X");
    opB.retain(3);

    // Process A first -> "adef"
    const resultA = await server.receiveOperation(DOC_ID, 0, opA, "clientA");
    expect(resultA.revision).toBe(1);

    let doc = await server.getDocument(DOC_ID);
    expect(doc!.content).toBe("adef");

    // Process B at rev 0, needs transform against A
    mockGetOperationsSince.mockResolvedValueOnce([
      {
        document_id: DOC_ID,
        revision: 1,
        author_id: "clientA",
        operations: opA.toJSON(),
      },
    ]);

    const resultB = await server.receiveOperation(DOC_ID, 0, opB, "clientB");
    expect(resultB.revision).toBe(2);

    doc = await server.getDocument(DOC_ID);
    // After A: "abcdef" -> "adef"
    // B's insert at pos 3 in original was between c and d.
    // After A deleted bc, that position maps to position 1 in "adef".
    // So "X" should go between "a" and "d" -> "aXdef"
    expect(doc!.content).toBe("aXdef");
  });
});

// ===========================================================================
// 4. applyFullContent
// ===========================================================================

describe("applyFullContent", () => {
  it("computes diff and applies as operation", async () => {
    const server = await serverWithDoc("hello world", 0);

    const result = await server.applyFullContent(
      DOC_ID,
      "hello beautiful world",
      "container"
    );

    expect(result).not.toBeNull();
    expect(result!.revision).toBe(1);

    const doc = await server.getDocument(DOC_ID);
    expect(doc!.content).toBe("hello beautiful world");
  });

  it("returns null when content is unchanged", async () => {
    const server = await serverWithDoc("same content", 5);

    const result = await server.applyFullContent(DOC_ID, "same content", "container");

    expect(result).toBeNull();
    expect(mockSaveOperation).not.toHaveBeenCalled();
  });

  it("handles complete content replacement", async () => {
    const server = await serverWithDoc("old content", 0);

    const result = await server.applyFullContent(
      DOC_ID,
      "completely new text",
      "container"
    );

    expect(result).not.toBeNull();
    const doc = await server.getDocument(DOC_ID);
    expect(doc!.content).toBe("completely new text");
  });

  it("throws when document is not in memory", async () => {
    const server = new OTServer();

    await expect(
      server.applyFullContent("nonexistent:doc", "content", "user")
    ).rejects.toThrow(/Document not found/);
  });
});

// ===========================================================================
// 5. Document creation (first access creates from S3 content)
// ===========================================================================

describe("document creation", () => {
  it("creates document from S3 content when no DB record exists", async () => {
    mockLoadDocument.mockResolvedValueOnce(null);
    mockLoadFileFromS3.mockResolvedValueOnce("print('hello')");

    const server = new OTServer();
    const doc = await server.createDocument(BUCKET_ID, FILE_PATH, BUCKET_INFO);

    expect(doc.content).toBe("print('hello')");
    expect(doc.revision).toBe(0);
    expect(doc.id).toBe(DOC_ID);
    expect(doc.bucketId).toBe(BUCKET_ID);
    expect(doc.filePath).toBe(FILE_PATH);

    // Should persist to DB
    expect(mockSaveDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        id: DOC_ID,
        bucket_id: BUCKET_ID,
        file_path: FILE_PATH,
        current_revision: 0,
        content: "print('hello')",
      })
    );
  });

  it("creates document with empty content when S3 file does not exist", async () => {
    mockLoadDocument.mockResolvedValueOnce(null);
    mockLoadFileFromS3.mockResolvedValueOnce(null);

    const server = new OTServer();
    const doc = await server.createDocument(BUCKET_ID, FILE_PATH, BUCKET_INFO);

    expect(doc.content).toBe("");
    expect(doc.revision).toBe(0);
  });

  it("creates document with empty content when S3 throws", async () => {
    mockLoadDocument.mockResolvedValueOnce(null);
    mockLoadFileFromS3.mockRejectedValueOnce(new Error("S3 network error"));

    const server = new OTServer();
    const doc = await server.createDocument(BUCKET_ID, FILE_PATH, BUCKET_INFO);

    expect(doc.content).toBe("");
    expect(doc.revision).toBe(0);
  });

  it("loads existing document from DB", async () => {
    mockLoadDocument.mockResolvedValueOnce({
      id: DOC_ID,
      bucket_id: BUCKET_ID,
      file_path: FILE_PATH,
      current_revision: 5,
      content: "db content",
      created_at: "2024-01-01",
      updated_at: "2024-01-01",
    });
    // S3 content matches DB so no update needed
    mockLoadFileFromS3.mockResolvedValueOnce("db content");

    const server = new OTServer();
    const doc = await server.createDocument(BUCKET_ID, FILE_PATH, BUCKET_INFO);

    expect(doc.content).toBe("db content");
    expect(doc.revision).toBe(5);
  });

  it("prefers S3 content when it differs from DB", async () => {
    mockLoadDocument.mockResolvedValueOnce({
      id: DOC_ID,
      bucket_id: BUCKET_ID,
      file_path: FILE_PATH,
      current_revision: 5,
      content: "db content",
      created_at: "2024-01-01",
      updated_at: "2024-01-01",
    });
    // S3 has different content - container changed the file directly
    mockLoadFileFromS3.mockResolvedValueOnce("s3 updated content");

    const server = new OTServer();
    const doc = await server.createDocument(BUCKET_ID, FILE_PATH, BUCKET_INFO);

    expect(doc.content).toBe("s3 updated content");
    expect(doc.revision).toBe(6); // incremented by 1

    // Should save updated content to DB
    expect(mockSaveDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        id: DOC_ID,
        current_revision: 6,
        content: "s3 updated content",
      })
    );
  });

  it("returns cached document on subsequent getDocument calls", async () => {
    mockLoadDocument.mockResolvedValueOnce(null);
    mockLoadFileFromS3.mockResolvedValueOnce("cached content");

    const server = new OTServer();
    await server.createDocument(BUCKET_ID, FILE_PATH, BUCKET_INFO);

    // Second call should not hit persistence
    const doc = await server.getDocument(DOC_ID, BUCKET_ID, FILE_PATH, BUCKET_INFO);

    expect(doc!.content).toBe("cached content");
    // loadDocument should only have been called once (during create)
    expect(mockLoadDocument).toHaveBeenCalledTimes(1);
  });

  it("getDocument returns null when no creation params provided and doc not cached", async () => {
    const server = new OTServer();
    const doc = await server.getDocument(DOC_ID);
    expect(doc).toBeNull();
  });
});

// ===========================================================================
// 6. Force save
// ===========================================================================

describe("forceSaveDocument", () => {
  it("saves document to both Postgres and S3", async () => {
    const server = await serverWithDoc("saved content", 3);

    await server.forceSaveDocument(DOC_ID);

    expect(mockSaveDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        id: DOC_ID,
        bucket_id: BUCKET_ID,
        file_path: FILE_PATH,
        current_revision: 3,
        content: "saved content",
      })
    );
    expect(mockSaveFileToS3).toHaveBeenCalledWith(
      BUCKET_INFO,
      FILE_PATH,
      "saved content"
    );
  });

  it("clears pending debounced save before force saving", async () => {
    const server = await serverWithDoc("content", 0);

    // Trigger a debounced save by applying an operation
    const op = new TextOperation();
    op.retain(7);
    op.insert("!");
    await server.receiveOperation(DOC_ID, 0, op, "user-1");

    // At this point a debounced save timeout is pending
    // Force save should clear it and save immediately
    jest.clearAllMocks();
    mockSaveDocument.mockResolvedValue(undefined);
    mockSaveFileToS3.mockResolvedValue(undefined);

    await server.forceSaveDocument(DOC_ID);

    expect(mockSaveDocument).toHaveBeenCalledTimes(1);
    expect(mockSaveFileToS3).toHaveBeenCalledTimes(1);

    // After the debounce period, should NOT fire again (it was cleared)
    jest.clearAllMocks();
    mockSaveDocument.mockResolvedValue(undefined);
    mockSaveFileToS3.mockResolvedValue(undefined);

    jest.advanceTimersByTime(5000);

    expect(mockSaveDocument).not.toHaveBeenCalled();
    expect(mockSaveFileToS3).not.toHaveBeenCalled();
  });

  it("does nothing when document is not in memory", async () => {
    const server = new OTServer();

    // Should not throw
    await server.forceSaveDocument("nonexistent:doc");

    expect(mockSaveDocument).not.toHaveBeenCalled();
    expect(mockSaveFileToS3).not.toHaveBeenCalled();
  });

  it("saves updated content after operations have been applied", async () => {
    const server = await serverWithDoc("start", 0);

    const op = new TextOperation();
    op.retain(5);
    op.insert(" end");
    await server.receiveOperation(DOC_ID, 0, op, "user-1");

    jest.clearAllMocks();
    mockSaveDocument.mockResolvedValue(undefined);
    mockSaveFileToS3.mockResolvedValue(undefined);

    await server.forceSaveDocument(DOC_ID);

    expect(mockSaveDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        current_revision: 1,
        content: "start end",
      })
    );
    expect(mockSaveFileToS3).toHaveBeenCalledWith(
      BUCKET_INFO,
      FILE_PATH,
      "start end"
    );
  });
});
