# Codex, Claude and Antigravity

From this checkout run `node runtime/setup.mjs`. This creates project-local `.mcp.json` for Claude Code and `.codex/config.toml` for Codex, with absolute executable/launcher/database paths. It refuses to replace an existing different configuration. Generated machine-specific files are ignored by git; no secrets are written. Open this repository as a trusted project and reconnect the MCP servers in the client. Existing conversations may need a restart/reconnect to discover new tools; generating a config does not prove the current conversation has loaded it.

Both clients use `node runtime/launch.mjs agents` and `node runtime/launch.mjs browser`. The launcher resolves dependencies/state from this checkout even when launched from a different directory. `VIEWER_QUEUE_DB` overrides the default `.viewer-live/agent-queue.db`. Queue and browser MCP are local stdio services. Do not publish browser profile directories, tokens or SQLite files to remote services.

For the local dashboard: set `VIEWER_QUEUE_DB` to that same absolute queue path, run `npm run viewer:dev`, open `http://127.0.0.1:3100/lab`. The dashboard shows actual queue state and reports, accepts tasks, cancellation and review. It deliberately binds loopback and rejects cross-origin mutations. The phone uses the authenticated Telegram gateway, rather than a public dashboard.

Antigravity remains an existing, manually opened conversation. Its selected model is configured in Antigravity; the bridge cannot attest model identity. Run the canonical `agents:wait` with the exact project and database. Each report must be followed by rearming the waiter. The bridge cannot revive an inactive conversation or repair a provider stream error; those require resuming that conversation. No Antigravity CLI is installed.

The two stdio launchers are verified with real MCP SDK clients from a different working directory. Live execution/rearm evidence is in `live-bridge.md`. This does not claim that the current Codex or Claude chat has already loaded the generated config.

Configuration references: [official OpenAI MCP documentation](https://learn.chatgpt.com/docs/extend/mcp), [official Claude Code MCP documentation](https://code.claude.com/docs/en/mcp).
