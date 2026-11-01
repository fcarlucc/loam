# Security and privacy

This app exists so that your chats never leave your computer. This page says what that promise covers, how it is
enforced, and how to report a problem.

## The promise

- **Your chats stay on your machine.** Messages, attachments and settings are stored in a local SQLite database.
  Nothing is sent to a server, there is no account, no telemetry and no analytics.
- **Only you can reach the app.** The server listens on `127.0.0.1`, so other devices on your network can't connect.
- **Other websites can't use it.** The API rejects requests whose `Host` isn't local (DNS rebinding) and changes that
  don't come from the app's own page (CSRF).
- **Replies can't phone home.** Images in model replies are shown as links and never loaded automatically.
- **Deleted means deleted.** Deleting a chat also wipes its text from the database files (SQLite `secure_delete`).

The only outbound connections are the ones you ask for (downloading a model through Ollama) and Next.js fetching the
Geist font files once when it compiles.

## How it is checked

The promise is tested, not just stated. `npm run test:api` starts the app as a user would, with a throwaway database and
a fake Ollama, and checks the loopback-only binding, the `Host` and `Origin` guards on every API route (new routes
included), and that deleted chats are gone from the files. The tests run on every push (see the CI badge in the README).

## Known limits

- Ollama's own API (port 11434) also listens on the loopback only, but by default Ollama lets any page served from
  `localhost` call it directly (`OLLAMA_ORIGINS`). Another local web app could use your models; this app can't change
  that.
- If the app's process is killed with `kill -9`, it can't stop Ollama, which keeps running until you stop it.
- Anyone with access to your user account can read the database file, like any other file you own.

## Reporting a vulnerability

Please report security issues privately through GitHub: **Security → Report a vulnerability** on this repository.
Don't open a public issue for them. You will get an answer within a few days.
