import { createRequire } from "node:module";
const VENDOR = "/Users/tanveersinghsaini/Desktop/cyraops-v2/vendor/dsh";
const anchor = `${VENDOR}/package.json`;
// 1. plain Node lookup from the new anchor
console.log("native resolve dsh-headless ->", createRequire(anchor).resolve("@deepseek-ai/dsh-headless"));
console.log("native resolve dsh-app-boot  ->", createRequire(anchor).resolve("@deepseek-ai/dsh-app-boot"));
// 2. the real runtime resolution table
const { createRuntimeResolution } = await import(`${VENDOR}/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js`);
const resolution = await createRuntimeResolution({ installAnchor: anchor, profile: undefined });
console.log("resolution entries:", resolution.entries.length);
for (const name of ["@deepseek-ai/dsh", "@deepseek-ai/dsh-headless", "@deepseek-ai/dsh-base", "@deepseek-ai/dsh-app-boot", "@deepseek-ai/cordis", "@deepseek-ai/dsh-cmdline"]) {
  const e = resolution.entries.find((e) => e.name === name);
  console.log(`  ${name} -> ${e ? e.packageDir : "MISSING"}`);
}
