import { Effect, Console } from "effect";
import * as Fs from "node:fs/promises";
import * as Path from "node:path";
import { execSync } from "node:child_process";
import {
  BuildError,
  CONFIG,
  buildACPs,
  execCommandWithOutput,
  findDMG,
  getRepoRoot,
  loadEnvFile,
  resolveRequiredEnvVar,
  signVendorBinaries,
} from "./shared.js";

// ============================================================================
// Architecture Detection
// ============================================================================

const detectArch = (): { arch: "aarch64" | "x64"; target: string; label: string } => {
  const uname = execSync("uname -m", { encoding: "utf-8" }).trim();
  if (uname === "arm64") {
    return { arch: "aarch64", target: "aarch64-apple-darwin", label: "Apple Silicon" };
  }
  return { arch: "x64", target: "x86_64-apple-darwin", label: "Intel" };
};

// ============================================================================
// Staging Build
// ============================================================================

const program = Effect.gen(function* () {
  const repoRoot = getRepoRoot();
  const { target, label } = detectArch();

  yield* Console.log("");
  yield* Console.log("===================================");
  yield* Console.log("     ACEPE STAGING BUILD");
  yield* Console.log("===================================");
  yield* Console.log(`Architecture: ${label} (${target})`);
  yield* Console.log("");

  // Load signing key
  const envPath = Path.join(repoRoot, ".env.local");
  const env = yield* loadEnvFile(envPath).pipe(
    Effect.orElseSucceed(() => ({} as Record<string, string>))
  );

  const signingKeyPath = Path.join(process.env.HOME || "", CONFIG.SIGNING_KEY_PATH);
  let signingKey = process.env.TAURI_SIGNING_PRIVATE_KEY;

  if (!signingKey) {
    signingKey = yield* Effect.tryPromise({
      try: () => Fs.readFile(signingKeyPath, "utf-8"),
      catch: () => undefined
    }).pipe(
      Effect.orElseSucceed(() => undefined)
    );
  }

  const signingKeyPassword = env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD || process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
  const appleSigningIdentity = env.APPLE_SIGNING_IDENTITY || process.env.APPLE_SIGNING_IDENTITY;
  const appleId = env.APPLE_ID || process.env.APPLE_ID;
  const applePassword = env.APPLE_PASSWORD || process.env.APPLE_PASSWORD;
  const appleTeamId = env.APPLE_TEAM_ID || process.env.APPLE_TEAM_ID;
  const sentryDsn = yield* resolveRequiredEnvVar("SENTRY_DSN", env);
  const viteSentryDsn = yield* resolveRequiredEnvVar("VITE_SENTRY_DSN", env);

  // Clean previous bundle output to prevent stale .app bundles ending up in the DMG
  yield* Console.log("1. Cleaning previous bundle output...");
  const bundleDir = Path.join(repoRoot, `packages/desktop/src-tauri/target/${target}/release/bundle`);
  yield* Effect.tryPromise({
    try: () => Fs.rm(bundleDir, { recursive: true, force: true }),
    catch: () => undefined
  }).pipe(Effect.orElseSucceed(() => undefined));
  yield* Console.log("   Done");

  // Build ACPs
  yield* Console.log("\n2. Building ACPs...");
  yield* buildACPs(repoRoot);

  // Sign vendor binaries before Tauri bundles them
  yield* Console.log("\n2b. Signing vendor binaries...");
  yield* signVendorBinaries(repoRoot, appleSigningIdentity);

  // Build Tauri with staging config overlay
  yield* Console.log(`\n3. Building Tauri app (${label})...`);
  yield* Console.log("   Using tauri.staging.conf.json overlay");
  yield* Console.log("   This may take a while...");

  const buildEnv: Record<string, string> = {
    MACOSX_DEPLOYMENT_TARGET: "10.15",
    SENTRY_DSN: sentryDsn,
    VITE_SENTRY_DSN: viteSentryDsn
  };
  if (signingKey) {
    buildEnv.TAURI_SIGNING_PRIVATE_KEY = signingKey;
  }
  if (signingKeyPassword) {
    buildEnv.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = signingKeyPassword;
  }
  if (appleSigningIdentity) {
    buildEnv.APPLE_SIGNING_IDENTITY = appleSigningIdentity;
  }
  if (appleId) {
    buildEnv.APPLE_ID = appleId;
  }
  if (applePassword) {
    buildEnv.APPLE_PASSWORD = applePassword;
  }
  if (appleTeamId) {
    buildEnv.APPLE_TEAM_ID = appleTeamId;
  }

  const stagingConfigPath = Path.join(repoRoot, "packages/desktop/src-tauri/tauri.staging.conf.json");

  yield* execCommandWithOutput("bunx", ["tauri", "build", "--target", target, "--config", stagingConfigPath], {
    cwd: Path.join(repoRoot, CONFIG.DESKTOP_PACKAGE_PATH),
    env: buildEnv
  });

  yield* Console.log("   Build complete");

  // Find and open DMG
  const dmgDir = Path.join(
    repoRoot,
    `packages/desktop/src-tauri/target/${target}/release/bundle/dmg`
  );
  const dmgPath = yield* findDMG(dmgDir);

  yield* Console.log("");
  yield* Console.log("===================================");
  yield* Console.log(`Staging build ready!`);
  yield* Console.log(`   ${dmgPath}`);
  yield* Console.log("===================================");
  yield* Console.log("");

  // Open the folder containing the DMG (not the DMG itself, to avoid double Finder windows)
  yield* Effect.try({
    try: () => { execSync(`open "${Path.dirname(dmgPath)}"`); },
    catch: () => new BuildError("Failed to open DMG folder")
  });
});

// Run with error handling
program.pipe(
  Effect.catchAll((error) => {
    return Effect.gen(function* () {
      yield* Console.log("");
      yield* Console.log("Staging build failed:");
      const errorMessage = typeof error === "string" ? error : error.message;
      yield* Console.log(`   ${errorMessage}`);

      if (error instanceof BuildError && error.output) {
        yield* Console.log(`   Output: ${error.output.slice(-1000)}`);
      }

      yield* Console.log("");
      process.exit(1);
    });
  }),
  Effect.runPromise
);
