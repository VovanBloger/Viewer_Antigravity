# Local development dashboard

`/lab` uses the same explicit `VIEWER_QUEUE_DB` as the executor and coordinator MCP service. Start with `npm run viewer:dev`, which binds `127.0.0.1:3100`. The dashboard is local only; the phone interface is the authenticated Telegram gateway.

The table displays the latest 100 tasks, newest first. Select a task to see its compact report, actual check results, revision, changed files, artifact references, open questions, failures, review remarks and the latest 30 events. Artifact paths are rendered as text, not passed into an arbitrary-file download endpoint. This page does not expose a browser profile, cookie store, filesystem browser or browser-control API.

Tasks submitted through the form target an exact registered project and default to local reports with Telegram/TTS disabled. An unchanged form retains its idempotency key after a network error, so retrying cannot enqueue a duplicate. Cancel and verdict requests carry the displayed task version; stale actions receive `409 TASK_CHANGED` and refresh before retrying. Returning a report requires nonempty remarks. Approving a report only changes queue state and does not merge or deploy code.

The HTTP API rejects non-loopback hosts, foreign Origin headers and cross-site fetches. It accepts JSON POSTs with a 40,000-byte limit enforced while reading the body, including when Content-Length is absent. Responses have no-store/nosniff headers, apply secret redaction to all fields including events, and project summaries omit filesystem paths. Local origin checks are not authentication against another untrusted process running as the same OS user; run the Viewer only on loopback and do not publish this endpoint.

Verification: dashboard unit/integration tests exercise cross-origin rejection, exact-project routing, submission deduplication, UTF-8/streamed body limits, stale review rejection, required remarks, newest-first limiting and response redaction. The parent coordinator performs production-build and real-browser acceptance checks separately.
