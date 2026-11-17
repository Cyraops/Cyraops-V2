/**
 * Next.js calls this once when the server boots. Everything that touches the
 * filesystem lives in the node-only module so no Node builtins are pulled into
 * an edge bundle.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
