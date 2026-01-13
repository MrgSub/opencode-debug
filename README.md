# OpenCode Debug Plugin

Last updated: January 13, 2026

A debug plugin for [OpenCode](https://github.com/anomalyco/opencode) that enables runtime debugging by capturing data from instrumented code. Similar to Cursor's debug mode, this plugin allows the agent to insert fetch calls into your codebase, capture runtime data, and analyze it to identify issues.

## Installation

Add the plugin to your OpenCode configuration:

```json
{
  "plugin": ["@thecto/opencode-debug-plugin@latest"]
}
```

## How It Works

The debug plugin enables a powerful debugging workflow:

1. **Start Debug Mode** — The agent starts a local HTTP server to receive debug events
2. **Instrument Code** — The agent inserts `fetch()` calls at strategic locations in your codebase
3. **Reproduce the Issue** — You run your code and reproduce the bug
4. **Analyze Logs** — The agent reads the captured data to identify the problem
5. **Clean Up** — The agent removes the debug fetch calls and stops the server

## Features

- **Runtime Data Capture** — Capture function inputs, outputs, state changes, and errors
- **Local Debug Server** — HTTP server to receive debug events
- **Ngrok Tunneling** — Expose your debug server publicly for remote/deployed debugging
- **Persistent Logging** — All debug events are written to `.opencode/debug.log`
- **Agent-Guided Workflow** — The agent knows how to instrument code and analyze results

## Tools

| Tool           | Description                                           |
| -------------- | ----------------------------------------------------- |
| `debug_start`  | Start debug mode and get instrumentation instructions |
| `debug_stop`   | Stop debug mode (remember to remove fetch calls)      |
| `debug_read`   | Read and analyze the captured debug data              |
| `debug_clear`  | Clear the debug log for a fresh session               |
| `debug_status` | Check if debug mode is active and get the debug URL   |

## Usage

### Starting a Debug Session

When you ask the agent to debug an issue, it will:

```
debug_start
```

This starts the debug server and provides the agent with instructions on how to instrument your code.

### Instrumentation

The agent will insert fetch calls like this at key locations:

```javascript
fetch("http://localhost:PORT/debug", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ label: "function-entry", data: { arg1, arg2 } }),
}).catch(() => {});
```

Common instrumentation points:

- Function entry/exit points
- Before/after async operations
- Inside catch blocks for errors
- State changes and variable mutations
- Conditional branches to trace control flow

### Reading Debug Data

After you reproduce the issue:

```
debug_read
debug_read tail=20
```

The agent analyzes the captured data to identify:

- Execution flow
- Unexpected values
- Error locations
- State discrepancies

### Stopping Debug Mode

```
debug_stop
```

The agent will also remove the fetch calls it inserted.

## Enabling Ngrok (Public URLs)

For debugging deployed applications or remote environments:

1. Get an authtoken from [ngrok.com](https://dashboard.ngrok.com/get-started/your-authtoken)
2. In OpenCode, run:
   ```
   opencode auth login
   ```
3. Select **Other** → **ngrok**
4. Enter your ngrok authtoken

Or set the environment variable:

```bash
export NGROK_AUTHTOKEN=your_token_here
```

Once configured, `debug_start` automatically creates a public tunnel.

## Example Workflow

**You:** "The checkout function is returning the wrong total"

**Agent:**

1. Calls `debug_start`
2. Reads the checkout code
3. Inserts fetch calls to capture cart items, prices, discounts, and the final total
4. Says "I've instrumented the checkout function. Please try checking out now."

**You:** Reproduce the checkout bug

**Agent:**

1. Calls `debug_read`
2. Sees: `cart-items: [...]`, `discount-applied: 0.15`, `subtotal: 100`, `final-total: 80`
3. Identifies: "The discount is being applied twice. The subtotal shows 100 but the final total is 80 instead of 85."
4. Fixes the bug and calls `debug_stop`
5. Removes the debug fetch calls

## License

MIT
