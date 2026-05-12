import app from "./app";
import { logger } from "./lib/logger";
import { startVaultCleanup } from "./routes/vault";

// Start the PO token engine before the server begins accepting
// connections — cold-start token is available immediately.
import { start as startOpentracer } from "./lib/opentracer";
startOpentracer("playd", "yt");

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  startVaultCleanup();
});
