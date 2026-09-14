-- WO-226 (performance review, LOW): the standalone btree index on doc_updates.document_id is redundant —
-- the unique constraint on (document_id, seq) from 0009_doc_updates.sql already provides a leading-column
-- btree index that covers every query in this codebase filtering by document_id alone
-- (listForDocument/listSinceSeq/maxSeqForDocument), so this index was pure write overhead with no query
-- benefit. Hand-trimmed from drizzle-kit's own generated output, which also emitted a spurious drop+recreate
-- of "doc_comments_body_no_control_chars" (byte-for-byte identical constraint expression before and after,
-- confirmed against 0011_doc_comments.sql) — unrelated to this WO's scope, so left out.
DROP INDEX "doc_updates_document_id_idx";
