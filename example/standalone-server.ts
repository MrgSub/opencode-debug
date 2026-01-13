/**
 * Standalone debug server for testing
 * 
 * Run: bun example/standalone-server.ts [port]
 */

const PORT = parseInt(process.argv[2] || "3333", 10);
const LOG_FILE = ".opencode/debug.log";

// Ensure log directory exists
import { mkdir } from "fs/promises";
await mkdir(".opencode", { recursive: true });

async function appendToLog(label: string, data?: unknown): Promise<void> {
  const timestamp = new Date().toISOString();
  const line = data !== undefined
    ? `[${timestamp}] ${label} | ${JSON.stringify(data)}\n`
    : `[${timestamp}] ${label}\n`;
  
  const file = Bun.file(LOG_FILE);
  const existing = (await file.exists()) ? await file.text() : "";
  await Bun.write(LOG_FILE, existing + line);
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Health check
    if (url.pathname === "/health" && req.method === "GET") {
      return Response.json({ status: "ok" }, { headers: corsHeaders });
    }

    // Debug endpoint
    if (url.pathname === "/debug" && req.method === "POST") {
      const body = await req.json().catch(() => null);
      if (!body || !body.label) {
        return new Response("Missing required field: label", {
          status: 400,
          headers: corsHeaders,
        });
      }
      
      await appendToLog(body.label, body.data);
      console.log(`[LOG] ${body.label}`, body.data ? JSON.stringify(body.data) : "");
      
      return Response.json({ received: true }, { headers: corsHeaders });
    }

    return new Response("Not found", { status: 404, headers: corsHeaders });
  },
});

console.log(`Debug server running at http://localhost:${PORT}`);
console.log(`Debug endpoint: http://localhost:${PORT}/debug`);
console.log(`Health check: http://localhost:${PORT}/health`);
console.log(`Log file: ${LOG_FILE}`);
console.log("\nWaiting for debug logs...\n");
