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

const config: PluginConfig = { ...defaultConfig };

let debugModeActive = false;
let activeDebugUrl: string | null = null;

function generateFetchSnippet(
  url: string,
  label: string,
  dataExpr: string = "{}"
): string {
  return `fetch("${url}", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: "${label}", data: ${dataExpr} }) }).catch(() => {});`;
}

function getDebugInstructions(debugUrl: string): string {
  return `
## Debug Mode Instructions

You are now in DEBUG MODE. Your task is to instrument the codebase with fetch calls to capture runtime data for debugging.

### Workflow:
1. **Analyze the issue** - Understand what the user is trying to debug
2. **Identify key locations** - Find functions, handlers, or code paths relevant to the issue
3. **Insert fetch calls** - Place debug fetch calls at strategic points to capture:
   - Function inputs/outputs
   - State changes
   - Error conditions
   - Control flow branches
4. **Hand back to user** - Let them reproduce the issue
5. **Read logs** - Use debug_read to analyze the captured data

### Fetch Call Pattern:
\`\`\`javascript
${generateFetchSnippet(
  debugUrl,
  "descriptive-label",
  "{ variable1, variable2 }"
)}
\`\`\`

### Best Practices:
- Use descriptive labels like "user-login-start", "api-response", "error-caught"
- Capture relevant variables in the data object
- Place calls at function entry/exit points
- Add calls before and after async operations
- Capture error objects in catch blocks
- Don't forget to capture the state you're debugging

### Examples:
\`\`\`javascript
// At function entry
${generateFetchSnippet(debugUrl, "processOrder-entry", "{ orderId, items }")}

// Before async call
${generateFetchSnippet(debugUrl, "api-call-start", "{ endpoint, payload }")}

// After async call
${generateFetchSnippet(debugUrl, "api-call-complete", "{ response, status }")}

// In catch block
${generateFetchSnippet(
  debugUrl,
  "error-caught",
  "{ error: err.message, stack: err.stack }"
)}

// State changes
${generateFetchSnippet(debugUrl, "state-updated", "{ prevState, nextState }")}
\`\`\`

### Debug URL: ${debugUrl}
`;
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
    "experimental.chat.system.transform": async (_input, output) => {
      if (debugModeActive && activeDebugUrl) {
        output.system.push(getDebugInstructions(activeDebugUrl));
      }
    },
    tool: {
      debug_start: tool({
        description: `Start debug mode to capture runtime data from the codebase.

WORKFLOW:
1. Call this tool to start the debug server
2. Insert fetch() calls at strategic locations in the code to capture runtime data
3. Ask the user to reproduce the issue
4. Use debug_read to analyze the captured logs and identify the problem

This enables runtime debugging by capturing labeled data points as the code executes.`,
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
            const url = publicUrl ?? localUrl;
            return `Debug server already running!\n\nDebug URL: ${url}\n\n**Next Step:** Insert fetch() calls in the code where you need to capture data, then ask the user to reproduce the issue.`;
          }

          const port = await findAvailablePort(args.port);
          server = createDebugServer(port, LOG_PATH);

          const localUrl = buildDebugUrl(`http://localhost:${port}`);
          const token = process.env.NGROK_AUTHTOKEN ?? storedNgrokToken;
          const tunnelUrl = await startTunnel(port, token);
          const publicUrl = tunnelUrl ? buildDebugUrl(tunnelUrl) : null;
          const url = publicUrl ?? localUrl;

          debugModeActive = true;
          activeDebugUrl = url;

          const instructions = [
            "# Debug Mode Started\n",
            `**Debug URL:** ${url}`,
            `**Log File:** ${getLogDisplayPath()}`,
            "",
            "## Next Steps:",
            "1. **Instrument the code** - Insert fetch() calls at key locations",
            "2. **Hand back to user** - Ask them to reproduce the issue",
            "3. **Read logs** - Use debug_read to analyze captured data",
            "",
            "## Fetch Call Template:",
            "```javascript",
            generateFetchSnippet(url, "label-here", "{ key: value }"),
            "```",
            "",
            "## Placement Guidelines:",
            "- Function entry/exit points",
            "- Before/after async operations",
            "- Inside catch blocks for errors",
            "- State changes and variable mutations",
            "- Conditional branches to trace control flow",
            "",
            "Use descriptive labels like 'handleSubmit-entry', 'api-response', 'error-caught'",
          ];

          return instructions.join("\n");
        },
      }),
      debug_stop: tool({
        description: `Stop debug mode and preserve the captured logs.

Call this after debugging is complete. The log file is preserved so you can still read it with debug_read.
Remember to remove the fetch() calls you inserted in the codebase.`,
        args: {},
        async execute() {
          if (!server) {
            return "Debug server is not running.";
          }

          await stopServer();
          debugModeActive = false;
          activeDebugUrl = null;

          return [
            "# Debug Mode Stopped",
            "",
            `Log file preserved at: ${getLogDisplayPath()}`,
            "",
            "**Remember:** Remove the fetch() debug calls you inserted in the codebase.",
          ].join("\n");
        },
      }),
      debug_clear: tool({
        description: `Clear the debug log file to start fresh.

Use this before a new debugging session to remove old log entries.`,
        args: {},
        async execute() {
          const file = Bun.file(LOG_PATH);
          if (await file.exists()) {
            await Bun.write(LOG_PATH, "");
            return `Debug log cleared: ${getLogDisplayPath()}\n\nReady for fresh debug data.`;
          }
          return `Debug log does not exist yet: ${getLogDisplayPath()}`;
        },
      }),
      debug_read: tool({
        description: `Read the debug log to analyze captured runtime data.

Use this after the user has reproduced the issue to see what data was captured by your fetch() calls.
The logs show timestamped entries with labels and data payloads.

Analyze the captured data to:
- Trace the execution flow
- Identify unexpected values
- Find where errors occur
- Compare expected vs actual behavior`,
        args: {
          tail: tool.schema
            .number()
            .optional()
            .describe("Only show last N lines (useful for large logs)"),
        },
        async execute(args) {
          const file = Bun.file(LOG_PATH);
          if (!(await file.exists())) {
            return "No debug log yet.\n\n**Tip:** Make sure fetch() calls are in place and the user has reproduced the issue.";
          }

          const content = await file.text();
          const lines = content.trim().split("\n").filter(Boolean);

          if (lines.length === 0) {
            return "Debug log is empty.\n\n**Tip:** The instrumented code paths may not have been executed. Ask the user to reproduce the issue.";
          }

          const output =
            args.tail && args.tail > 0 ? lines.slice(-args.tail) : lines;

          return [
            `# Debug Log (${output.length} entries)`,
            "=".repeat(50),
            "",
            output.join("\n"),
            "",
            "=".repeat(50),
            "**Analyze the above data to identify the issue.**",
          ].join("\n");
        },
      }),
      debug_status: tool({
        description: `Check if debug mode is currently active and get the debug URL.`,
        args: {},
        async execute() {
          if (!server || !debugModeActive) {
            return "Debug mode is **not active**.\n\nUse debug_start to begin a debugging session.";
          }

          const localUrl = buildDebugUrl(`http://localhost:${server.port}`);
          const publicUrl = tunnel?.url ? buildDebugUrl(tunnel.url) : null;
          const url = publicUrl ?? localUrl;

          return [
            "# Debug Mode Active",
            "",
            `**Debug URL:** ${url}`,
            `**Log File:** ${getLogDisplayPath()}`,
            "",
            "Use this URL in your fetch() calls to capture debug data.",
          ].join("\n");
        },
      }),
    },
  };
};
