import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  fileName: text("file_name").notNull(),
  format: text("format").notNull(),
  isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
  parserJson: text("parser_json").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  lastExtractionId: text("last_extraction_id"),
});

export const extractionRuns = sqliteTable("extraction_runs", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  documentType: text("document_type").notNull(),
  schemaVersion: text("schema_version").notNull(),
  payload: text("payload").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  documentVersion: uniqueIndex("extraction_runs_document_version_uq").on(table.documentId, table.version),
  documentIndex: index("extraction_runs_document_idx").on(table.documentId, table.createdAt),
}));
