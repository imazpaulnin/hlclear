import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const blockedLiteralPatterns = [
  /["']approveBuilderFee["']/i,
  /private key/i,
  /firebase/i,
  /supabase/i,
  /console\.(log|debug|info|warn)\([^)]*(signature|privateKey|seed|mnemonic|rawResponse)/i,
  /localStorage\.(setItem|getItem)\([^)]*(privateKey|seed|mnemonic)/i
];
const blockedWalletPatterns = [/signClient\.connect/i, /provider\.client/i, /appKit\.open/i, /eip155:998/i];

const disallowedApiUrlPattern = /https?:\/\/(?!api\.hyperliquid\.xyz|api\.hyperliquid-testnet\.xyz)/i;
const allowedExternalUrlPatterns = [
  /https?:\/\/cloudflare-eth\.com/i,
  /https?:\/\/arb1\.arbitrum\.io/i,
  /https?:\/\/arbiscan\.io/i,
  /https?:\/\/rpc\.hyperliquid\.xyz/i,
  /https?:\/\/rpc\.hyperliquid-testnet\.xyz/i,
  /https?:\/\/app\.hyperliquid-testnet\.xyz/i,
  /https?:\/\/app\.hyperliquid\.xyz/i,
  /wss:\/\/relay\.walletconnect\.org/i
];

const ignoredDirectories = new Set(["node_modules", "dist", ".git", "reference", "docs"]);
const ignoredFiles = new Set([
  "README.md",
  "AGENTS.md",
  "package-lock.json",
  "scripts/check-security.mjs",
  "scripts/serve-dist.mjs",
  ".github/workflows/deploy-pages.yml"
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

    const relative = path.relative(root, absolute).split(path.sep).join("/");
    if (ignoredFiles.has(relative)) {
      continue;
    }
    const text = fs.readFileSync(absolute, "utf8");

    for (const pattern of blockedLiteralPatterns) {
      if (pattern.test(text)) {
        findings.push(`${relative}: matched ${pattern}`);
      }
    }

    if (relative.startsWith("src/wallet/")) {
      for (const pattern of blockedWalletPatterns) {
        if (pattern.test(text)) {
          findings.push(`${relative}: banned WalletConnect pattern ${pattern}`);
        }
      }
    }

    if (disallowedApiUrlPattern.test(text) && !allowedExternalUrlPatterns.some((pattern) => pattern.test(text))) {
      findings.push(`${relative}: contains a non-Hyperliquid external endpoint`);
    }
  }
}
