import "dotenv/config";
import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 3000);

const app = createApp();

await app.start(port);

// Diagnostics go to stderr to keep the HTTP server's stdout clean.
console.error(`[prompt-refiner-web] API + GUI listening on http://127.0.0.1:${port}`);
console.error(`[prompt-refiner-web] project root: ${app.root}`);
