// Read-only look at the app's SQLite database, to check what was really written.
import { DatabaseSync } from "node:sqlite";

// node:sqlite rows have a null prototype, which deepEqual tells apart from plain objects.
const plain = (row) => (row ? { ...row } : row);

export function openDb(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  return {
    raw: db,
    counts: () => plain(db.prepare("SELECT (SELECT count(*) FROM chats) AS chats, (SELECT count(*) FROM messages) AS messages").get()),
    chat: (id) => plain(db.prepare("SELECT * FROM chats WHERE id = ?").get(id)),
    messages: (chatId) =>
      db.prepare("SELECT id, parent_id, role, content, model, stats, thinking FROM messages WHERE chat_id = ? ORDER BY id").all(chatId).map(plain),
    close: () => db.close(),
  };
}
