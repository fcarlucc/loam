-- The database schema as the app created it before engines were added (chats, messages with versions,
-- attachments, benchmarks, settings and the search index). Produced by starting the app of that version with an
-- empty data directory and dumping sqlite_master; FTS5 shadow tables are left out, the virtual table recreates them.
-- The migration test builds a database from this file, fills it, opens it with the current app and checks that
-- nothing was lost or changed.

CREATE TABLE chats (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT    NOT NULL,
      model      TEXT    NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    , settings TEXT, leaf_id INTEGER, branch_of INTEGER REFERENCES chats(id) ON DELETE SET NULL);

CREATE TABLE messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id    INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      role       TEXT    NOT NULL CHECK (role IN ('user', 'assistant')),
      content    TEXT    NOT NULL,
      created_at INTEGER NOT NULL
    , stats TEXT, thinking TEXT, model TEXT, parent_id INTEGER REFERENCES messages(id) ON DELETE CASCADE, copied INTEGER NOT NULL DEFAULT 0);

CREATE INDEX messages_chat_idx ON messages(chat_id, id);

CREATE TABLE app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

CREATE TABLE benchmarks (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      model             TEXT    NOT NULL,
      created_at        INTEGER NOT NULL,
      cold              INTEGER NOT NULL, -- 1 if the model was unloaded first, so load time is included
      tokens            INTEGER NOT NULL,
      tokens_per_second REAL    NOT NULL,
      prompt_per_second REAL    NOT NULL,
      load_ms           INTEGER NOT NULL,
      total_ms          INTEGER NOT NULL
    );

CREATE INDEX messages_parent_idx ON messages(parent_id);

CREATE TABLE attachments (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      name       TEXT    NOT NULL,
      type       TEXT    NOT NULL, -- MIME type
      kind       TEXT    NOT NULL CHECK (kind IN ('text', 'image')),
      size       INTEGER NOT NULL, -- bytes
      text       TEXT,
      data       BLOB,
      created_at INTEGER NOT NULL
    );

CREATE INDEX attachments_message_idx ON attachments(message_id);

CREATE VIRTUAL TABLE messages_fts USING fts5(
        content, content = 'messages', content_rowid = 'id', tokenize = 'unicode61 remove_diacritics 2'
      );

CREATE TRIGGER messages_fts_insert AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts (rowid, content) VALUES (new.id, new.content);
      END;

CREATE TRIGGER messages_fts_delete AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts (messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
      END;

CREATE TRIGGER messages_fts_update AFTER UPDATE OF content ON messages BEGIN
        INSERT INTO messages_fts (messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
        INSERT INTO messages_fts (rowid, content) VALUES (new.id, new.content);
      END;
