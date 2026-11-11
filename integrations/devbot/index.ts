import { openStore, defaultDbPath } from "../../runtime/queue/index.ts";
import { TelegramClient } from "./client.ts";
import { TelegramGateway } from "./gateway.ts";

async function main() {
  const dbPath = process.env.VIEWER_QUEUE_DB || defaultDbPath();
  const store = openStore({ dbPath });
  const client = new TelegramClient();

  const gateway = new TelegramGateway(client, store);
  await gateway.start();
}

main().catch((err) => {
  console.error("[DevBot Index Error]:", err);
  process.exit(1);
});
