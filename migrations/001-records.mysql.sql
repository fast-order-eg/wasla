-- MySQL 8+, persistent document records shared with the local SQLite adapter.
-- Domain validation, references, order transitions and inventory changes live
-- in src/domain.js and execute in one transaction. All application writers use
-- the per-database named lock to serialize inventory and deduplication checks.
-- Do not write directly into app_records from another application.
CREATE TABLE IF NOT EXISTS app_records (
  collection VARCHAR(64) NOT NULL,
  id VARCHAR(191) NOT NULL,
  payload JSON NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  PRIMARY KEY (collection, id),
  INDEX records_updated (collection, updated_at)
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
