import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const outputPath = path.join(projectRoot, ".well-known", "assetlinks.json");

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return "";
  return String(process.argv[index + 1] || "").trim();
}

const packageName = readArg("--package") || process.env.TRANSCHAT_ANDROID_PACKAGE || "com.transchat.chat";
const rawFingerprints = [
  ...process.argv.filter((value, index) => process.argv[index - 1] === "--fingerprint"),
  ...String(process.env.TRANSCHAT_SHA256_FINGERPRINTS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
];

const fingerprints = [...new Set(rawFingerprints)].filter(Boolean);
const content = [
  {
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: packageName,
      sha256_cert_fingerprints: fingerprints.length ? fingerprints : ["REPLACE_WITH_PLAY_APP_SIGNING_SHA256"],
    },
  },
];

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(content, null, 2)}\n`, "utf8");

console.log(`[assetlinks] wrote ${outputPath}`);
console.log(`[assetlinks] package: ${packageName}`);
console.log(`[assetlinks] fingerprints: ${content[0].target.sha256_cert_fingerprints.join(", ")}`);
