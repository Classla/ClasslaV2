-- OT Documents table
CREATE TABLE IF NOT EXISTS ot_documents (
  id TEXT PRIMARY KEY,
  bucket_id UUID NOT NULL,
  file_path TEXT NOT NULL,
  current_revision INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(bucket_id, file_path)
);

-- OT Operations log
CREATE TABLE IF NOT EXISTS ot_operations (
  id BIGSERIAL PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES ot_documents(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  author_id TEXT NOT NULL,
  operations JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(document_id, revision)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ot_operations_doc_rev ON ot_operations(document_id, revision);
CREATE INDEX IF NOT EXISTS idx_ot_documents_bucket ON ot_documents(bucket_id);
