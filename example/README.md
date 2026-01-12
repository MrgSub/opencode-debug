# Debug Plugin Test Examples

## Quick Test

```bash
# Terminal 1: Start standalone server
bun example/standalone-server.ts

# Terminal 2: Send test logs
bun example/test-debug.ts
```

## Files

- `standalone-server.ts` - Standalone debug server (mirrors plugin behavior)
- `test-debug.ts` - Client that sends test logs to verify server works

## Custom Port

```bash
bun example/standalone-server.ts 4000
bun example/test-debug.ts 4000
```

## Log Output

Logs are written to `.opencode/debug.log` in the format:
```
[timestamp] label | {"json":"data"}
```
