import { build } from "esbuild";

await build({
  bundle: true,
  entryPoints: ["src/main.ts"],
  format: "cjs",
  logLevel: "info",
  outfile: "dist/index.cjs",
  platform: "node",
  sourcemap: false,
  target: "node24",
});
