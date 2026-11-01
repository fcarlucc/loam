import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isKeepAlive, KEEP_ALIVE_DEFAULT, parseSettings } from "./settings";
import type {
  Attachment,
  BenchmarkResult,
  ChatMessage,
  ChatSettings,
  ChatSummary,
  EngineKind,
  NewAttachment,
  ReplyStats,
  Role,
  SearchHit,
  Usage,
} from "./types";

// Title of chats created by earlier versions before their first message.
export const DEFAULT_TITLE = "New chat";

// One connection, opened on first use and kept across dev hot reloads.
const g = globalThis as unknown as { __db?: DatabaseSync };
let migrated = false;

function db() {
  if (!g.__db) {
    // OLLAMA_WRAP_DATA_DIR lets the end-to-end tests use a throwaway database instead of your chats.
    const dir = process.env.OLLAMA_WRAP_DATA_DIR || join(process.cwd(), "data");
    mkdirSync(dir, { recursive: true });
    g.__db = new DatabaseSync(join(dir, "ollama-wrap.db"));
  }
  // Runs once per module load, so a hot reload also migrates the connection it inherits.
  if (!migrated) {
    migrate(g.__db);
    migrated = true;
  }
  return g.__db;
}

function migrate(conn: DatabaseSync) {
  conn.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA secure_delete = ON; -- deleted rows are overwritten in the file, not just marked as free space
    CREATE TABLE IF NOT EXISTS chats (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT    NOT NULL,
      model      TEXT    NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id    INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      role       TEXT    NOT NULL CHECK (role IN ('user', 'assistant')),
      content    TEXT    NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_chat_idx ON messages(chat_id, id);
    CREATE TABLE IF NOT EXISTS app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  addColumn(conn, "chats", "settings", "TEXT"); // JSON ChatSettings
  addColumn(conn, "messages", "stats", "TEXT"); // JSON ReplyStats
  addColumn(conn, "messages", "thinking", "TEXT"); // what a reasoning model thought before the reply

  // Which model wrote each reply, for usage per model. Replies saved before this existed get the
  // chat's current model, the best guess available.
  if (!hasColumn(conn, "messages", "model")) {
    conn.exec("BEGIN");
    try {
      conn.exec("ALTER TABLE messages ADD COLUMN model TEXT");
      conn.exec(`UPDATE messages SET model = (SELECT model FROM chats WHERE chats.id = messages.chat_id) WHERE role = 'assistant'`);
      conn.exec("COMMIT");
    } catch (e) {
      conn.exec("ROLLBACK");
      throw e;
    }
  }
  conn.exec(`
    CREATE TABLE IF NOT EXISTS benchmarks (
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
  `);

  // A conversation is a tree: each message points to the one it follows, so an edited message or a
  // regenerated reply is a sibling (a "version"). chats.leaf_id is the last message of the branch on screen.
  // Columns and backfill go in one transaction, so a failure can't leave half-migrated chats behind.
  if (!hasColumn(conn, "messages", "parent_id")) {
    conn.exec("BEGIN");
    try {
      conn.exec("ALTER TABLE messages ADD COLUMN parent_id INTEGER REFERENCES messages(id) ON DELETE CASCADE");
      conn.exec("ALTER TABLE chats ADD COLUMN leaf_id INTEGER");
      // Chats saved so far are linear: every message follows the previous one.
      conn.exec(`UPDATE messages SET parent_id =
        (SELECT MAX(p.id) FROM messages p WHERE p.chat_id = messages.chat_id AND p.id < messages.id)`);
      conn.exec("UPDATE chats SET leaf_id = (SELECT MAX(id) FROM messages WHERE chat_id = chats.id)");
      conn.exec("COMMIT");
    } catch (e) {
      conn.exec("ROLLBACK");
      throw e;
    }
  }
  conn.exec("CREATE INDEX IF NOT EXISTS messages_parent_idx ON messages(parent_id)");

  // A chat can be branched off another one (see branchChat): it starts with a copy of the branch it came
  // from. branch_of is that chat, cleared when it is deleted; copied marks the copied messages, so usage
  // counts each reply once, in the chat where it was written.
  addColumn(conn, "chats", "branch_of", "INTEGER REFERENCES chats(id) ON DELETE SET NULL");
  addColumn(conn, "messages", "copied", "INTEGER NOT NULL DEFAULT 0");

  // Files attached to user messages, kept with the chat and deleted with it. Text files keep their text,
  // images their bytes (already resized by the page). Not part of the search index.
  conn.exec(`
    CREATE TABLE IF NOT EXISTS attachments (
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
    CREATE INDEX IF NOT EXISTS attachments_message_idx ON attachments(message_id);
  `);

  // Full-text index over message text for search, kept in sync by triggers (cascade deletes included).
  // Accents are ignored, so "cafe" finds "café".
  const hasIndex = conn.prepare("SELECT 1 FROM sqlite_master WHERE name = 'messages_fts'").get();
  conn.exec("BEGIN");
  try {
    conn.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content, content = 'messages', content_rowid = 'id', tokenize = 'unicode61 remove_diacritics 2'
      );
      CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts (rowid, content) VALUES (new.id, new.content);
      END;
      CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts (messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
      END;
      CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE OF content ON messages BEGIN
        INSERT INTO messages_fts (messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
        INSERT INTO messages_fts (rowid, content) VALUES (new.id, new.content);
      END;
    `);
    if (!hasIndex) conn.exec("INSERT INTO messages_fts (messages_fts) VALUES ('rebuild')"); // index existing messages
    conn.exec("COMMIT");
  } catch (e) {
    conn.exec("ROLLBACK");
    throw e;
  }

  // The engines the user added (see lib/engines): Ollama through its own API, or an OpenAI-compatible server.
  // The built-in Ollama has no row unless it was edited (then its row carries the same id, "ollama").
  conn.exec(`
    CREATE TABLE IF NOT EXISTS engines (
      id         TEXT    PRIMARY KEY,
      name       TEXT    NOT NULL,
      kind       TEXT    NOT NULL CHECK (kind IN ('ollama', 'openai')),
      base_url   TEXT    NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  // Which engine a chat was last continued with, and which one wrote each reply. Everything saved before
  // engines existed came from Ollama, the only engine there was: the column default says so, and replies
  // are backfilled in the same transaction as the column, so nothing is left half-migrated.
  addColumn(conn, "chats", "engine", "TEXT NOT NULL DEFAULT 'ollama'");
  if (!hasColumn(conn, "messages", "engine")) {
    conn.exec("BEGIN");
    try {
      conn.exec("ALTER TABLE messages ADD COLUMN engine TEXT");
      conn.exec("UPDATE messages SET engine = 'ollama' WHERE role = 'assistant'");
      conn.exec("COMMIT");
    } catch (e) {
      conn.exec("ROLLBACK");
      throw e;
    }
  }
  addColumn(conn, "benchmarks", "engine", "TEXT NOT NULL DEFAULT 'ollama'");
}

function hasColumn(conn: DatabaseSync, table: string, column: string) {
  const columns = conn.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return columns.some((c) => c.name === column);
}

function addColumn(conn: DatabaseSync, table: string, column: string, type: string) {
  if (!hasColumn(conn, table, column)) conn.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

function parseJson(text: unknown): unknown {
  if (typeof text !== "string") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

type ChatRow = Omit<ChatSummary, "settings"> & { settings: string | null };
type MessageRow = {
  id: number;
  parent_id: number | null;
  role: Role;
  content: string;
  stats: string | null;
  thinking: string | null;
  copied: number;
};

const CHAT_COLUMNS = "id, title, engine, model, settings, branch_of, created_at, updated_at";
const toChat = ({ settings, ...row }: ChatRow): ChatSummary => ({ ...row, settings: parseSettings(parseJson(settings)) ?? {} });

export function transaction<T>(fn: () => T): T {
  db().exec("BEGIN");
  try {
    const result = fn();
    db().exec("COMMIT");
    return result;
  } catch (e) {
    db().exec("ROLLBACK");
    throw e;
  }
}

export function listChats() {
  return (db().prepare(`SELECT ${CHAT_COLUMNS} FROM chats ORDER BY updated_at DESC, id DESC`).all() as ChatRow[]).map(toChat);
}

export function getChat(id: number) {
  const row = db().prepare(`SELECT ${CHAT_COLUMNS} FROM chats WHERE id = ?`).get(id) as ChatRow | undefined;
  return row && toChat(row);
}

export function createChat(title: string, engine: string, model: string, settings: ChatSettings) {
  const now = Date.now();
  const { lastInsertRowid } = db()
    .prepare("INSERT INTO chats (title, engine, model, settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(title, engine, model, JSON.stringify(settings), now, now);
  return Number(lastInsertRowid);
}

export function updateChat(id: number, fields: { title?: string; engine?: string; model?: string; settings?: ChatSettings }) {
  if (fields.title !== undefined) db().prepare("UPDATE chats SET title = ? WHERE id = ?").run(fields.title, id);
  if (fields.engine !== undefined) db().prepare("UPDATE chats SET engine = ? WHERE id = ?").run(fields.engine, id);
  if (fields.model !== undefined) db().prepare("UPDATE chats SET model = ? WHERE id = ?").run(fields.model, id);
  if (fields.settings !== undefined) {
    db().prepare("UPDATE chats SET settings = ? WHERE id = ?").run(JSON.stringify(fields.settings), id);
  }
}

// Deletes a chat and its messages for good: besides secure_delete, the search index is compacted (it can
// keep words of deleted messages in old segments) and the WAL is checkpointed and truncated (it keeps
// earlier copies of changed pages).
export function deleteChat(id: number) {
  db().prepare("DELETE FROM chats WHERE id = ?").run(id);
  db().exec("INSERT INTO messages_fts (messages_fts) VALUES ('optimize')");
  db().exec("PRAGMA wal_checkpoint(TRUNCATE)");
}

function messageRows(chatId: number) {
  return db()
    .prepare("SELECT id, parent_id, role, content, stats, thinking, copied FROM messages WHERE chat_id = ? ORDER BY id")
    .all(chatId) as MessageRow[];
}

// A message of this chat (null when the id belongs to another chat or doesn't exist).
export function getMessage(chatId: number, id: number) {
  return (
    (db().prepare("SELECT id, parent_id, role FROM messages WHERE id = ? AND chat_id = ?").get(id, chatId) as
      | Pick<MessageRow, "id" | "parent_id" | "role">
      | undefined) ?? null
  );
}

export function getLeafId(chatId: number) {
  const row = db().prepare("SELECT leaf_id FROM chats WHERE id = ?").get(chatId) as { leaf_id: number | null } | undefined;
  return row?.leaf_id ?? null;
}

// The branch ending at `leafId` (by default the one on screen), first message first, with each message's versions.
// Everything sent to the model is built from this, so other branches never leak into its context.
export function getPath(chatId: number, leafId: number | null = getLeafId(chatId)): ChatMessage[] {
  const rows = messageRows(chatId);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const siblings = new Map<number | null, number[]>();
  for (const r of rows) siblings.set(r.parent_id, [...(siblings.get(r.parent_id) ?? []), r.id]);
  const attachments = attachmentsOf(chatId);

  const path: ChatMessage[] = [];
  for (let row = leafId === null ? undefined : byId.get(leafId); row; row = row.parent_id === null ? undefined : byId.get(row.parent_id)) {
    const ids = siblings.get(row.parent_id) ?? [row.id];
    const stats = parseJson(row.stats) as ReplyStats | undefined;
    const files = attachments.get(row.id);
    path.unshift({
      id: row.id,
      role: row.role,
      content: row.content,
      ...(files ? { attachments: files } : {}),
      ...(row.thinking ? { thinking: row.thinking } : {}),
      ...(stats ? { stats } : {}),
      ...(ids.length > 1 ? { versions: { ids, index: ids.indexOf(row.id) } } : {}),
      ...(row.copied ? { copied: true } : {}),
    });
  }
  return path;
}

// Adds a message after `parentId` and makes it the end of the branch on screen. Returns its id.
export function addMessage(
  chatId: number,
  role: Role,
  content: string,
  parentId: number | null,
  reply?: { engine: string; model: string; stats?: ReplyStats; thinking?: string },
) {
  const now = Date.now();
  const { lastInsertRowid } = db()
    .prepare(
      "INSERT INTO messages (chat_id, parent_id, role, content, engine, model, stats, thinking, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      chatId,
      parentId,
      role,
      content,
      reply?.engine ?? null,
      reply?.model ?? null,
      reply?.stats ? JSON.stringify(reply.stats) : null,
      reply?.thinking ?? null,
      now,
    );
  const id = Number(lastInsertRowid);
  db().prepare("UPDATE chats SET updated_at = ?, leaf_id = ? WHERE id = ?").run(now, id, chatId);
  return id;
}

type AttachmentRow = Attachment & { id: number; message_id: number };

export function addAttachments(messageId: number, list: NewAttachment[]) {
  const insert = db().prepare(
    "INSERT INTO attachments (message_id, name, type, kind, size, text, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const now = Date.now();
  for (const a of list) {
    if (a.kind === "image") {
      const bytes = Buffer.from(a.data, "base64");
      insert.run(messageId, a.name, a.type, a.kind, bytes.length, null, bytes, now);
    } else {
      insert.run(messageId, a.name, a.type, a.kind, Buffer.byteLength(a.data), a.data, null, now);
    }
  }
}

// A new version of a message keeps the files of the one it replaces.
export function copyAttachments(fromMessageId: number, toMessageId: number) {
  db()
    .prepare(
      `INSERT INTO attachments (message_id, name, type, kind, size, text, data, created_at)
       SELECT ?, name, type, kind, size, text, data, ? FROM attachments WHERE message_id = ? ORDER BY id`,
    )
    .run(toMessageId, Date.now(), fromMessageId);
}

// What the page shows about each message's files, by message id (only messages that have any).
function attachmentsOf(chatId: number) {
  const rows = db()
    .prepare(
      `SELECT a.id, a.message_id, a.name, a.type, a.kind, a.size FROM attachments a
       JOIN messages m ON m.id = a.message_id WHERE m.chat_id = ? ORDER BY a.id`,
    )
    .all(chatId) as AttachmentRow[];
  const byMessage = new Map<number, Attachment[]>();
  for (const { message_id, ...a } of rows) byMessage.set(message_id, [...(byMessage.get(message_id) ?? []), a]);
  return byMessage;
}

// What goes to the model for one message: text files, and images as base64 with their MIME type.
export function attachmentContents(messageId: number) {
  const rows = db()
    .prepare("SELECT name, type, kind, text, data FROM attachments WHERE message_id = ? ORDER BY id")
    .all(messageId) as { name: string; type: string; kind: Attachment["kind"]; text: string | null; data: Uint8Array | null }[];
  return {
    files: rows.filter((r) => r.kind === "text").map((r) => ({ name: r.name, text: r.text ?? "" })),
    images: rows.filter((r) => r.kind === "image").map((r) => ({ data: Buffer.from(r.data ?? new Uint8Array()).toString("base64"), type: r.type })),
  };
}

export function getAttachment(id: number) {
  return db().prepare("SELECT id, name, type, kind, size, text, data FROM attachments WHERE id = ?").get(id) as
    | (Attachment & { id: number; text: string | null; data: Uint8Array | null })
    | undefined;
}

// Starts a new chat from the branch ending at `messageId`, so the conversation can go on there in another
// direction while this chat stays as it is. Only that branch is copied, without the other versions of its
// messages. Messages, files, reasoning and stats are copies, not shared rows, so deleting either chat leaves
// the other whole. Returns the new chat's id.
export function branchChat(chatId: number, messageId: number, title: string, settings: ChatSettings) {
  return transaction(() => {
    // Walks up from the message to the first one; a parent always has a smaller id than its replies.
    const rows = db()
      .prepare(
        `WITH RECURSIVE branch(id) AS (
           SELECT id FROM messages WHERE id = ? AND chat_id = ?
           UNION ALL
           SELECT m.parent_id FROM messages m JOIN branch b ON m.id = b.id WHERE m.parent_id IS NOT NULL
         )
         SELECT m.id, m.role, m.content, m.engine, m.model, m.stats, m.thinking, m.created_at
           FROM messages m JOIN branch USING (id) ORDER BY m.id`,
      )
      .all(messageId, chatId) as (Pick<MessageRow, "id" | "role" | "content" | "stats" | "thinking"> & {
      engine: string | null;
      model: string | null;
      created_at: number;
    })[];
    if (!rows.length) throw new Error("Message not found");

    const now = Date.now();
    const { lastInsertRowid } = db()
      .prepare(
        `INSERT INTO chats (title, engine, model, settings, branch_of, created_at, updated_at)
         SELECT ?, engine, model, ?, id, ?, ? FROM chats WHERE id = ?`,
      )
      .run(title, JSON.stringify(settings), now, now, chatId);
    const branchId = Number(lastInsertRowid);
    const insert = db().prepare(
      `INSERT INTO messages (chat_id, parent_id, role, content, engine, model, stats, thinking, created_at, copied)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    );
    let parent: number | null = null;
    for (const m of rows) {
      const copy: number = Number(
        insert.run(branchId, parent, m.role, m.content, m.engine, m.model, m.stats, m.thinking, m.created_at).lastInsertRowid,
      );
      copyAttachments(m.id, copy);
      parent = copy;
    }
    db().prepare("UPDATE chats SET leaf_id = ? WHERE id = ?").run(parent, branchId);
    return branchId;
  });
}

// Shows another version of a message: the branch continues with its newest follow-ups.
// Browsing versions doesn't count as activity, so the chat keeps its place in the sidebar.
export function selectVersion(chatId: number, messageId: number) {
  let leaf = messageId;
  for (;;) {
    const child = db()
      .prepare("SELECT MAX(id) AS id FROM messages WHERE chat_id = ? AND parent_id = ?")
      .get(chatId, leaf) as { id: number | null };
    if (child.id === null) break;
    leaf = child.id;
  }
  db().prepare("UPDATE chats SET leaf_id = ? WHERE id = ?").run(leaf, chatId);
}

// Chats whose title matches (if none of their messages does), then messages (any version) ranked by relevance.
// The query is reduced to plain words, so user input can't break the search syntax; the last word may be partial.
export function search(query: string, limit = 40): SearchHit[] {
  const words = query.match(/[\p{L}\p{N}_]+/gu) ?? [];
  if (words.length === 0) return [];
  const match = words.map((w, i) => `"${w}"${i === words.length - 1 ? "*" : ""}`).join(" ");
  const like = `%${query.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

  const titles = db()
    .prepare(`SELECT id AS chatId, title FROM chats WHERE title LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT 10`)
    .all(like) as { chatId: number; title: string }[];
  const messages = db()
    .prepare(
      `SELECT m.chat_id AS chatId, c.title, m.id AS messageId, m.role,
              snippet(messages_fts, 0, char(2), char(3), '…', 14) AS snippet -- see MARK_START / MARK_END
         FROM messages_fts
         JOIN messages m ON m.id = messages_fts.rowid
         JOIN chats c ON c.id = m.chat_id
        WHERE messages_fts MATCH ?
        ORDER BY rank
        LIMIT ?`,
    )
    .all(match, limit) as SearchHit[];
  // A title hit is only worth listing for chats that have no matching message.
  const withMessages = new Set(messages.map((m) => m.chatId));
  const titleHits = titles.filter((t) => !withMessages.has(t.chatId)).map((t) => ({ ...t, messageId: null, role: null, snippet: null }));
  return [...titleHits, ...messages];
}

function getAppSetting(key: string): unknown {
  const row = db().prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string } | undefined;
  return parseJson(row?.value);
}

function setAppSetting(key: string, value: unknown) {
  db()
    .prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, JSON.stringify(value));
}

// Settings applied to new chats.
export const getDefaults = (): ChatSettings => parseSettings(getAppSetting("chat_defaults")) ?? {};
export const setDefaults = (settings: ChatSettings) => setAppSetting("chat_defaults", settings);

// How long models stay in memory after a reply (seconds, see KEEP_ALIVE_CHOICES).
export const getKeepAlive = (): number => {
  const value = getAppSetting("keep_alive");
  return isKeepAlive(value) ? value : KEEP_ALIVE_DEFAULT;
};
export const setKeepAlive = (seconds: number) => setAppSetting("keep_alive", seconds);

// Usage overview: totals, replies per day (last 30 days, local time) and per model. Messages copied into a
// branched chat were counted where they were written.
export function getUsage(): Usage {
  const since = Date.now() - 30 * 24 * 3600 * 1000;
  const totals = db()
    .prepare(
      `SELECT (SELECT count(*) FROM chats) AS chats,
              count(*) FILTER (WHERE role = 'user') AS sent,
              count(*) FILTER (WHERE role = 'assistant') AS replies,
              coalesce(sum(json_extract(stats, '$.tokens')), 0) AS tokens,
              coalesce(sum(json_extract(stats, '$.totalMs')), 0) AS generatingMs
         FROM messages WHERE copied = 0`,
    )
    .get() as Usage["totals"];
  const daily = db()
    .prepare(
      `SELECT date(created_at / 1000, 'unixepoch', 'localtime') AS day, count(*) AS replies,
              coalesce(sum(json_extract(stats, '$.tokens')), 0) AS tokens
         FROM messages WHERE role = 'assistant' AND copied = 0 AND created_at >= ?
        GROUP BY day ORDER BY day`,
    )
    .all(since) as Usage["daily"];
  // A reply that spent over a second loading the model counts as a cold start.
  const models = db()
    .prepare(
      `SELECT coalesce(engine, 'ollama') AS engine, model, count(*) AS replies,
              coalesce(sum(json_extract(stats, '$.tokens')), 0) AS tokens,
              avg(json_extract(stats, '$.tokensPerSecond')) AS avgTokensPerSecond,
              count(*) FILTER (WHERE json_extract(stats, '$.loadMs') > 1000) AS coldStarts,
              avg(json_extract(stats, '$.loadMs')) FILTER (WHERE json_extract(stats, '$.loadMs') > 1000) AS avgColdLoadMs
         FROM messages WHERE role = 'assistant' AND copied = 0 AND model IS NOT NULL
        GROUP BY engine, model ORDER BY replies DESC`,
    )
    .all() as Usage["models"];
  return { totals, daily, models };
}

export function addBenchmark(r: Omit<BenchmarkResult, "id" | "createdAt">) {
  db()
    .prepare(
      `INSERT INTO benchmarks (engine, model, created_at, cold, tokens, tokens_per_second, prompt_per_second, load_ms, total_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(r.engine, r.model, Date.now(), r.cold ? 1 : 0, r.tokens, r.tokensPerSecond, r.promptPerSecond, r.loadMs, r.totalMs);
}

export function listBenchmarks(limit = 50): BenchmarkResult[] {
  const rows = db()
    .prepare(
      `SELECT id, engine, model, created_at AS createdAt, cold, tokens, tokens_per_second AS tokensPerSecond,
              prompt_per_second AS promptPerSecond, load_ms AS loadMs, total_ms AS totalMs
         FROM benchmarks ORDER BY id DESC LIMIT ?`,
    )
    .all(limit) as (Omit<BenchmarkResult, "cold"> & { cold: number })[];
  return rows.map((r) => ({ ...r, cold: r.cold === 1 }));
}

export function clearBenchmarks() {
  db().exec("DELETE FROM benchmarks");
}

// The engines the user added or edited (the built-in Ollama is assembled in lib/engines from these rows).
export type EngineRow = { id: string; name: string; kind: EngineKind; base_url: string; created_at: number };

export function listEngineRows(): EngineRow[] {
  return db().prepare("SELECT id, name, kind, base_url, created_at FROM engines ORDER BY created_at, id").all() as EngineRow[];
}

export function getEngineRow(id: string): EngineRow | undefined {
  return db().prepare("SELECT id, name, kind, base_url, created_at FROM engines WHERE id = ?").get(id) as EngineRow | undefined;
}

// Inserts the engine, or updates its name and URL when a row with this id exists (editing the built-in Ollama).
export function saveEngineRow(row: Omit<EngineRow, "created_at">) {
  db()
    .prepare(
      `INSERT INTO engines (id, name, kind, base_url, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind, base_url = excluded.base_url`,
    )
    .run(row.id, row.name, row.kind, row.base_url, Date.now());
}

export function deleteEngineRow(id: string) {
  db().prepare("DELETE FROM engines WHERE id = ?").run(id);
}
