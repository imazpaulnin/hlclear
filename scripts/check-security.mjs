import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const blockedLiteralPatterns = [
  /["']approveBuilderFee["']/i,
  /private key/i,
  /walletconnect/i,
  /firebase/i,
  /supabase/i,
  /console\.(log|debug|info|warn)\([^)]*(signature|privateKey|seed|mnemonic|rawResponse)/i,
  /localStorage\.(setItem|getItem)\([^)]*(privateKey|seed|mnemonic)/i
];

const disallowedApiUrlPattern = /https?:\/\/(?!api\.hyperliquid\.xyz|api\.hyperliquid-testnet\.xyz)/i;

const ignoredDirectories = new Set(["node_modules", "dist", ".git", "reference", "docs"]);
const ignoredFiles = new Set([
  "README.md",
  "AGENTS.md",
  "package-lock.json",
  "scripts\\check-security.mjs",
  "scripts\\serve-dist.mjs",
  ".github\\workflows\\deploy-pages.yml"
]);

const findings = [];

walk(root);

if (findings.length > 0) {
  console.error("Security check failed:");
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log("Security check passed.");

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) {
      continue;
    }

    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(absolute);
      continue;
    }

    const relative = path.relative(root, absolute);
    if (ignoredFiles.has(relative)) {
      continue;
    }
    const text = fs.readFileSync(absolute, "utf8");

    for (const pattern of blockedLiteralPatterns) {
      if (pattern.test(text)) {
        findings.push(`${relative}: matched ${pattern}`);
      }
    }

    if (disallowedApiUrlPattern.test(text)) {
      findings.push(`${relative}: contains a non-Hyperliquid external endpoint`);
    }
  }
}
