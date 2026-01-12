/**
 * Simple test app to verify debug server receives logs
 * 
 * Usage:
 * 1. Start the debug server (port 3333 by default)
 * 2. Run: bun example/test-debug.ts [port]
 */

const DEBUG_PORT = process.argv[2] || "3333";
const DEBUG_URL = `http://localhost:${DEBUG_PORT}/debug`;

async function sendLog(label: string, data?: unknown): Promise<boolean> {
  try {
    const res = await fetch(DEBUG_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, data }),
    });
    return res.ok;
  } catch (err) {
    console.error(`Failed to send log "${label}":`, err);
    return false;
  }
}

async function main() {
  console.log(`Testing debug server at ${DEBUG_URL}\n`);

  // Test 1: Simple label only
  console.log("1. Sending simple label...");
  const t1 = await sendLog("test-start");
  console.log(`   Result: ${t1 ? "OK" : "FAILED"}`);

  // Test 2: Label with data object
  console.log("2. Sending label with data...");
  const t2 = await sendLog("user-action", { userId: 123, action: "click", target: "button" });
  console.log(`   Result: ${t2 ? "OK" : "FAILED"}`);

  // Test 3: Nested data
  console.log("3. Sending nested data...");
  const t3 = await sendLog("api-response", {
    status: 200,
    body: { items: [1, 2, 3], meta: { page: 1, total: 100 } },
  });
  console.log(`   Result: ${t3 ? "OK" : "FAILED"}`);

  // Test 4: Error simulation
  console.log("4. Sending error data...");
  const t4 = await sendLog("error-caught", {
    error: "Something went wrong",
    stack: "Error: Something went wrong\n    at main (test.ts:50:10)",
  });
  console.log(`   Result: ${t4 ? "OK" : "FAILED"}`);

  // Test 5: State change
  console.log("5. Sending state change...");
  const t5 = await sendLog("state-updated", {
    prevState: { count: 0, loading: true },
    nextState: { count: 5, loading: false },
  });
  console.log(`   Result: ${t5 ? "OK" : "FAILED"}`);

  console.log("\n--- Summary ---");
  const passed = [t1, t2, t3, t4, t5].filter(Boolean).length;
  console.log(`${passed}/5 tests passed`);

  if (passed === 5) {
    console.log("\nAll logs sent successfully! Check .opencode/debug.log for entries.");
  } else {
    console.log("\nSome tests failed. Is the debug server running?");
    console.log(`Try: Start debug mode in OpenCode first, then run this test.`);
  }
}

main();
