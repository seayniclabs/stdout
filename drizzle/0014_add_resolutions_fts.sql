CREATE VIRTUAL TABLE resolutions_fts USING fts5(content, content='resolutions', content_rowid='rowid');--> statement-breakpoint
CREATE TRIGGER resolutions_fts_insert AFTER INSERT ON resolutions BEGIN
  INSERT INTO resolutions_fts(rowid, content) VALUES (new.rowid, new.content);
END;--> statement-breakpoint
CREATE TRIGGER resolutions_fts_update AFTER UPDATE ON resolutions BEGIN
  UPDATE resolutions_fts SET content = new.content WHERE rowid = old.rowid;
END;--> statement-breakpoint
CREATE TRIGGER resolutions_fts_delete AFTER DELETE ON resolutions BEGIN
  DELETE FROM resolutions_fts WHERE rowid = old.rowid;
END;
