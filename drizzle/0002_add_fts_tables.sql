CREATE VIRTUAL TABLE incidents_fts USING fts5(title, description, tags, content='incidents', content_rowid='rowid');--> statement-breakpoint
CREATE TRIGGER incidents_fts_insert AFTER INSERT ON incidents BEGIN
  INSERT INTO incidents_fts(rowid, title, description, tags) VALUES (new.rowid, new.title, new.description, new.tags);
END;--> statement-breakpoint
CREATE TRIGGER incidents_fts_update AFTER UPDATE ON incidents BEGIN
  UPDATE incidents_fts SET title = new.title, description = new.description, tags = new.tags WHERE rowid = old.rowid;
END;--> statement-breakpoint
CREATE TRIGGER incidents_fts_delete AFTER DELETE ON incidents BEGIN
  DELETE FROM incidents_fts WHERE rowid = old.rowid;
END;--> statement-breakpoint
CREATE VIRTUAL TABLE docs_fts USING fts5(title, content, tags, content='docs', content_rowid='rowid');--> statement-breakpoint
CREATE TRIGGER docs_fts_insert AFTER INSERT ON docs BEGIN
  INSERT INTO docs_fts(rowid, title, content, tags) VALUES (new.rowid, new.title, new.content, new.tags);
END;--> statement-breakpoint
CREATE TRIGGER docs_fts_update AFTER UPDATE ON docs BEGIN
  UPDATE docs_fts SET title = new.title, content = new.content, tags = new.tags WHERE rowid = old.rowid;
END;--> statement-breakpoint
CREATE TRIGGER docs_fts_delete AFTER DELETE ON docs BEGIN
  DELETE FROM docs_fts WHERE rowid = old.rowid;
END;
