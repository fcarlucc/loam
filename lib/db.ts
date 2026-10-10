import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseSettings } from "./settings";
import type { ChatMessage, ChatSettings, ChatSummary, ReplyStats, Role } from "./types";

// Title of chats created by earlier versions before their first message.
export const DEFAULT_TITLE = "New chat";

// One connection, opened on first use and kept across dev hot reloads.
const g = globalThis as unknown as { __db?: DatabaseSync };
let migrated = false;

function db() {
  if (!g.__db) {
    const dir = join(process.cwd(), "data");
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
type MessageRow = { id: number; parent_id: number | null; role: Role; content: string; stats: string | null };

const CHAT_COLUMNS = "id, title, model, settings, created_at, updated_at";
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

export function createChat(title: string, model: string, settings: ChatSettings) {
  const now = Date.now();
  const { lastInsertRowid } = db()
    .prepare("INSERT INTO chats (title, model, settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(title, model, JSON.stringify(settings), now, now);
  return Number(lastInsertRowid);
}

export function updateChat(id: number, fields: { title?: string; model?: string; settings?: ChatSettings }) {
  if (fields.title !== undefined) db().prepare("UPDATE chats SET title = ? WHERE id = ?").run(fields.title, id);
  if (fields.model !== undefined) db().prepare("UPDATE chats SET model = ? WHERE id = ?").run(fields.model, id);
  if (fields.settings !== undefined) {
    db().prepare("UPDATE chats SET settings = ? WHERE id = ?").run(JSON.stringify(fields.settings), id);
  }
}

export function deleteChat(id: number) {
  db().prepare("DELETE FROM chats WHERE id = ?").run(id);
}

function messageRows(chatId: number) {
  return db()
    .prepare("SELECT id, parent_id, role, content, stats FROM messages WHERE chat_id = ? ORDER BY id")
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

  const path: ChatMessage[] = [];
  for (let row = leafId === null ? undefined : byId.get(leafId); row; row = row.parent_id === null ? undefined : byId.get(row.parent_id)) {
    const ids = siblings.get(row.parent_id) ?? [row.id];
    const stats = parseJson(row.stats) as ReplyStats | undefined;
    path.unshift({
      id: row.id,
      role: row.role,
      content: row.content,
      ...(stats ? { stats } : {}),
      ...(ids.length > 1 ? { versions: { ids, index: ids.indexOf(row.id) } } : {}),
    });
  }
  return path;
}

// Adds a message after `parentId` and makes it the end of the branch on screen. Returns its id.
export function addMessage(chatId: number, role: Role, content: string, parentId: number | null, stats?: ReplyStats) {
  const now = Date.now();
  const { lastInsertRowid } = db()
    .prepare("INSERT INTO messages (chat_id, parent_id, role, content, stats, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(chatId, parentId, role, content, stats ? JSON.stringify(stats) : null, now);
  const id = Number(lastInsertRowid);
  db().prepare("UPDATE chats SET updated_at = ?, leaf_id = ? WHERE id = ?").run(now, id, chatId);
  return id;
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

// Settings applied to new chats.
export function getDefaults(): ChatSettings {
  const row = db().prepare("SELECT value FROM app_settings WHERE key = 'chat_defaults'").get() as { value: string } | undefined;
  return parseSettings(parseJson(row?.value)) ?? {};
}

export function setDefaults(settings: ChatSettings) {
  db()
    .prepare("INSERT INTO app_settings (key, value) VALUES ('chat_defaults', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(JSON.stringify(settings));
}
