import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";

export interface PluginConfig {
  endpoint: string;
  healthEndpoint: string;
  logDir: string;
  logFileName: string;
  authProvider: string;
  authLabel: string;
  authPromptMessage: string;
}

const defaultConfig: PluginConfig = {
  endpoint: "/debug",
  healthEndpoint: "/health",
  logDir: ".opencode",
  logFileName: "debug.log",
  authProvider: "ngrok",
  authLabel: "Configure Ngrok Token",
  authPromptMessage: "Enter your Ngrok Authtoken",
};

let config: PluginConfig = { ...defaultConfig };

export function configure(overrides: Partial<PluginConfig>): void {
  config = { ...defaultConfig, ...overrides };
}

async function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    Bun.connect({
      hostname: "127.0.0.1",
      port,
      socket: {
        open(socket) {
          socket.end();
          resolve(true);
        },
        error() {
          resolve(false);
        },
        data() {},
        close() {},
      },
    }).catch(() => resolve(false));
  });
}

async function findAvailablePort(preferred?: number): Promise<number> {
  if (preferred !== undefined && !(await isPortInUse(preferred))) {
    return preferred;
  }
  const testServer = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = testServer.port!;
  testServer.stop();
  return port;
}

async function appendToLog(
  logPath: string,
  label: string,
  data?: unknown
): Promise<void> {
  const timestamp = new Date().toISOString();
  const line =
    data !== undefined
      ? `[${timestamp}] ${label} | ${JSON.stringify(data)}\n`
      : `[${timestamp}] ${label}\n`;
  const file = Bun.file(logPath);
  const existing = (await file.exists()) ? await file.text() : "";
  await Bun.write(logPath, existing + line);
}

function jsonResponse(data: object, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createDebugServer(
  port: number,
  logPath: string
): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === config.healthEndpoint && req.method === "GET") {
        return jsonResponse({ status: "ok" });
      }

      if (url.pathname === config.endpoint && req.method === "POST") {
        const body = await req.json().catch(() => null);
        if (!body || !body.label) {
          return new Response("Missing required field: label", { status: 400 });
        }
        await appendToLog(logPath, body.label, body.data);
        return jsonResponse({ received: true });
      }

      return new Response("Not found", { status: 404 });
    },
  });
}

function buildDebugUrl(baseUrl: string): string {
  return `${baseUrl}${config.endpoint}`;
}

let server: ReturnType<typeof Bun.serve> | null = null;
let tunnel: { url: string; close: () => Promise<void> } | null = null;

async function startTunnel(
  port: number,
  authtoken?: string
): Promise<string | null> {
  const token = process.env.NGROK_AUTHTOKEN ?? authtoken;
  if (!token) return null;

  const ngrok = await import("@ngrok/ngrok");
  const listener = await ngrok.forward({ addr: port, authtoken: token });
  const url = listener.url();
  if (!url) return null;

  tunnel = { url, close: () => listener.close() };
  return url;
}

async function stopServer(): Promise<void> {
  if (tunnel) {
    await tunnel.close().catch(() => {});
    tunnel = null;
  }
  if (server) {
    server.stop();
    server = null;
  }
}

let storedNgrokToken: string | undefined;

function getLogPath(directory: string): string {
  return `${directory}/${config.logDir}/${config.logFileName}`;
}

function getLogDisplayPath(): string {
  return `${config.logDir}/${config.logFileName}`;
}

export const DebugPlugin: Plugin = async ({ directory }) => {
  const LOG_PATH = getLogPath(directory);

  return {
    auth: {
      provider: config.authProvider,
      loader: async (getAuth) => {
        const auth = await getAuth();
        console.log("auth", auth);
        if (auth?.type === "api") storedNgrokToken = auth.key;
        return {};
      },
      methods: [
        {
          type: "api" as const,
          label: config.authLabel,
          prompts: [
            {
              type: "text" as const,
              key: "token",
              message: config.authPromptMessage,
            },
          ],
          async authorize(inputs) {
            if (!inputs?.token) return { type: "failed" as const };
            return { type: "success" as const, key: inputs.token };
          },
        },
      ],
    },
    tool: {
      debug_start: tool({
        description: "Start the debug HTTP server for remote debugging",
        args: {
          port: tool.schema
            .number()
            .optional()
            .describe("Port for local server (default: auto-select)"),
        },
        async execute(args) {
          if (server) {
            const localUrl = buildDebugUrl(`http://localhost:${server.port}`);
            const publicUrl = tunnel?.url ? buildDebugUrl(tunnel.url) : null;
            return `Debug server already running!\n\nLocal: ${localUrl}${
              publicUrl ? `\nPublic: ${publicUrl}` : ""
            }`;
          }

          const port = await findAvailablePort(args.port);
          server = createDebugServer(port, LOG_PATH);

          const localUrl = buildDebugUrl(`http://localhost:${port}`);
          const token = process.env.NGROK_AUTHTOKEN ?? storedNgrokToken;
          const tunnelUrl = await startTunnel(port, token);
          const publicUrl = tunnelUrl ? buildDebugUrl(tunnelUrl) : null;
          const url = publicUrl ?? localUrl;

          const publicLine =
            publicUrl ?? "N/A (run 'opencode auth' to configure ngrok)";
          const usage = [
            `fetch("${url}", {`,
            `  method: "POST",`,
            `  headers: { "Content-Type": "application/json" },`,
            `  body: JSON.stringify({ label: "my-event", data: { optional: "payload" } })`,
            `})`,
          ].join("\n");

          return [
            "Debug server started!\n",
            `Local: ${localUrl}`,
            `Public: ${publicLine}`,
            `\nUsage:\n${usage}`,
            `\nLog file: ${getLogDisplayPath()}`,
          ].join("\n");
        },
      }),
      debug_stop: tool({
        description: "Stop the debug HTTP server",
        args: {},
        async execute() {
          if (!server) {
            return "Debug server is not running.";
          }

          await stopServer();
          return `Debug server stopped.\nLog file preserved at: ${getLogDisplayPath()}`;
        },
      }),
      debug_clear: tool({
        description: "Clear the debug log file",
        args: {},
        async execute() {
          const file = Bun.file(LOG_PATH);
          if (await file.exists()) {
            await Bun.write(LOG_PATH, "");
            return `Debug log cleared: ${getLogDisplayPath()}`;
          }
          return `Debug log does not exist yet: ${getLogDisplayPath()}`;
        },
      }),
      debug_read: tool({
        description: "Read the debug log file",
        args: {
          tail: tool.schema
            .number()
            .optional()
            .describe("Only show last N lines"),
        },
        async execute(args) {
          const file = Bun.file(LOG_PATH);
          if (!(await file.exists())) {
            return "No debug log yet. Start your instrumented code to generate logs.";
          }

          const content = await file.text();
          const lines = content.trim().split("\n").filter(Boolean);

          if (lines.length === 0) {
            return "Debug log is empty.";
          }

          const output =
            args.tail && args.tail > 0 ? lines.slice(-args.tail) : lines;
          return `Debug Log (${output.length} entries)\n${"=".repeat(
            40
          )}\n${output.join("\n")}`;
        },
      }),
    },
    config: async () => {},
  };
};

// export default DebugPlugin;
