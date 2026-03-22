import { Effect, Console } from "effect";
import { select } from "@inquirer/prompts";
import * as Fs from "node:fs/promises";
import * as Path from "node:path";
import { execSync } from "node:child_process";
import {
  BuildError,
  CONFIG,
  ConfigError,
  GitError,
  S3Error,
  VersionError,
  buildACPs,
  buildTauri,
  execCommand,
  findDMG,
  getRepoRoot,
  loadEnvFile,
  resolveRequiredEnvVar,
  signVendorBinaries,
  verifyMacBundleSigning,
} from "./shared.js";

// ============================================================================
// Types
// ============================================================================

interface ReleaseConfig {
  readonly version: string;
  readonly bucket: string;
  readonly endpoint: string;
  readonly cdnBaseUrl: string;
  readonly awsAccessKeyId: string;
  readonly awsSecretAccessKey: string;
  readonly awsRegion: string;
  readonly sentryDsn: string;
  readonly viteSentryDsn: string;
  readonly mixpanelToken: string;
  readonly viteMixpanelToken: string;
  readonly signingKey?: string;
  readonly signingKeyPassword?: string;
  readonly appleSigningIdentity?: string;
  readonly appleId?: string;
  readonly applePassword?: string;
  readonly appleTeamId?: string;
  readonly repoRoot: string;
}

interface LatestJson {
  readonly version: string;
  readonly pub_date: string;
  readonly platforms: Readonly<Record<string, {
    readonly signature: string;
    readonly url: string;
  }>>;
}

// ============================================================================
// Validation
// ============================================================================

const validateAwsKey = (key: string, name: string): string => {
  const trimmed = key.trim();
  if (!trimmed) {
    throw new ConfigError(`${name} cannot be empty`, name);
  }
  // Railway bucket keys should start with specific prefixes
  if (name.includes("ACCESS_KEY") && !trimmed.startsWith("tid_")) {
    throw new ConfigError(
      `${name} should start with 'tid_' (Railway bucket access key format)`,
      name,
      trimmed.substring(0, 10) + "..."
    );
  }
  if (name.includes("SECRET_KEY") && !trimmed.startsWith("tsec_")) {
    throw new ConfigError(
      `${name} should start with 'tsec_' (Railway bucket secret key format)`,
      name,
      trimmed.substring(0, 10) + "..."
    );
  }
  return trimmed;
};

// ============================================================================
// Version Management
// ============================================================================

const generateVersion = (): Effect.Effect<string, VersionError> =>
  Effect.gen(function* () {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    const tags = yield* Effect.try({
      try: () => execSync(`git tag -l "v${year}.${month}.*"`, { encoding: "utf-8" }),
      catch: () => ""
    }).pipe(
      Effect.orElseSucceed(() => "")
    );

    const tagLines = tags.trim() ? tags.trim().split("\n") : [];
    const maxBuild = tagLines.reduce((max, tag) => {
      const match = tag.match(/^v\d+\.\d+\.(\d+)$/);
      return match ? Math.max(max, parseInt(match[1], 10)) : max;
    }, 0);
    const build = maxBuild + 1;

    const version = `${year}.${month}.${build}`;

    yield* Console.log(`Generated version: ${version} (${tagLines.length} existing tags this month, max build: ${maxBuild})`);
    yield* Console.log(`Note: If another release runs simultaneously, version collision may occur.`);
    yield* Console.log(`   The tag existence check will catch this, but you may need to retry.`);

    // Check if tag already exists
    const tagExists = yield* Effect.try({
      try: () => {
        try {
          execSync(`git rev-parse "v${version}"`, { stdio: "pipe" });
          return true;
        } catch {
          return false;
        }
      },
      catch: () => false
    }).pipe(
      Effect.orElseSucceed(() => false)
    );

    if (tagExists) {
      return yield* Effect.fail(new VersionError(
        `Tag v${version} already exists! Another release may have completed during this run. ` +
        `Please wait a moment and retry.`
      ));
    }

    return version;
  });

const updateTauriConfig = (version: string, repoRoot: string): Effect.Effect<void, ConfigError> =>
  Effect.gen(function* () {
    const configPath = Path.join(repoRoot, CONFIG.TAURI_CONFIG_PATH);

    yield* Console.log(`Updating ${configPath}...`);

    const content = yield* Effect.tryPromise({
      try: () => Fs.readFile(configPath, "utf-8"),
      catch: () => new ConfigError("Failed to read tauri.conf.json")
    });

    const config = JSON.parse(content);
    config.version = version;

    yield* Effect.tryPromise({
      try: () => Fs.writeFile(configPath, JSON.stringify(config, null, 2) + "\n"),
      catch: () => new ConfigError("Failed to write tauri.conf.json")
    });

    yield* Console.log(`Updated tauri.conf.json to version ${version}`);
  });

// ============================================================================
// Git Operations
// ============================================================================

const checkWorkingDirectory = (repoRoot: string): Effect.Effect<boolean, GitError> =>
  Effect.gen(function* () {
    const status = yield* execCommand("git status --porcelain", { cwd: repoRoot });
    const isClean = !status.trim();

    if (!isClean) {
      yield* Console.log("Uncommitted changes detected:");
      yield* Console.log(status);
    }

    return isClean;
  });

const commitVersionBump = (version: string, repoRoot: string): Effect.Effect<void, GitError> =>
  Effect.gen(function* () {
    yield* Console.log("Committing version bump...");
    yield* execCommand("git add packages/desktop/src-tauri/tauri.conf.json", { cwd: repoRoot });

    // Skip commit if nothing staged (e.g. retrying after a failed build)
    const staged = yield* execCommand("git diff --cached --name-only", { cwd: repoRoot });
    if (!staged.trim()) {
      yield* Console.log("Version already committed, skipping");
      return;
    }

    yield* execCommand(`git commit -m "release: v${version}"`, { cwd: repoRoot });
    yield* Console.log(`Committed: release: v${version}`);
  });

const createGitTag = (version: string, repoRoot: string): Effect.Effect<void, GitError> =>
  Effect.gen(function* () {
    yield* Console.log(`Creating git tag v${version}...`);
    yield* execCommand(`git tag "v${version}"`, { cwd: repoRoot });
    yield* Console.log(`Created tag v${version}`);
  });

const pushToRemote = (version: string, repoRoot: string): Effect.Effect<void, GitError> =>
  Effect.gen(function* () {
    yield* Console.log("Pushing to remote...");
    yield* execCommand("git push", { cwd: repoRoot });
    yield* execCommand("git push --tags", { cwd: repoRoot });
    yield* Console.log("Pushed commits and tags");
  });

// ============================================================================
// S3 Operations
// ============================================================================

const uploadToS3 = (
  localPath: string,
  s3Key: string,
  config: ReleaseConfig
): Effect.Effect<void, S3Error> =>
  Effect.gen(function* () {
    const cmd = [
      "s3", "cp", localPath, `s3://${config.bucket}/${s3Key}`,
      "--endpoint-url", config.endpoint
    ];

    yield* Effect.try({
      try: () => {
        execSync(`aws ${cmd.join(" ")}`, {
          env: {
            ...process.env,
            AWS_ACCESS_KEY_ID: config.awsAccessKeyId,
            AWS_SECRET_ACCESS_KEY: config.awsSecretAccessKey,
            AWS_REGION: config.awsRegion
          },
          stdio: "pipe"
        });
      },
      catch: (error) => {
        const execError = error as { stderr?: Buffer; message: string };
        const stderr = execError.stderr?.toString("utf-8") || "";
        throw new S3Error(
          `Failed to upload ${s3Key}: ${stderr || execError.message}`,
          "upload",
          s3Key
        );
      }
    });

    yield* Console.log(`  -> Uploaded: ${s3Key}`);
  });

const readLatestJson = (config: ReleaseConfig): Effect.Effect<LatestJson, S3Error> =>
  Effect.gen(function* () {
    const result = yield* Effect.try({
      try: () => {
        try {
          const output = execSync(
            `aws s3 cp s3://${config.bucket}/updates/latest.json - --endpoint-url ${config.endpoint}`,
            {
              env: {
                ...process.env,
                AWS_ACCESS_KEY_ID: config.awsAccessKeyId,
                AWS_SECRET_ACCESS_KEY: config.awsSecretAccessKey,
                AWS_REGION: config.awsRegion
              },
              encoding: "utf-8",
              stdio: ["pipe", "pipe", "pipe"]
            }
          );
          return JSON.parse(output) as LatestJson;
        } catch {
          return { version: "", pub_date: "", platforms: {} } as LatestJson;
        }
      },
      catch: () => ({ version: "", pub_date: "", platforms: {} } as LatestJson)
    }).pipe(
      Effect.orElseSucceed(() => ({ version: "", pub_date: "", platforms: {} } as LatestJson))
    );

    return result;
  });

const uploadLatestJson = (
  latestJson: LatestJson,
  config: ReleaseConfig
): Effect.Effect<void, S3Error> =>
  Effect.gen(function* () {
    const jsonString = JSON.stringify(latestJson, null, 2);

    yield* Effect.try({
      try: () => {
        execSync(
          `aws s3 cp - s3://${config.bucket}/updates/latest.json --endpoint-url ${config.endpoint} --content-type "application/json"`,
          {
            env: {
              ...process.env,
              AWS_ACCESS_KEY_ID: config.awsAccessKeyId,
              AWS_SECRET_ACCESS_KEY: config.awsSecretAccessKey,
              AWS_REGION: config.awsRegion
            },
            input: jsonString,
            encoding: "utf-8"
          }
        );
      },
      catch: (error) => {
        const execError = error as { stderr?: Buffer; message: string };
        const stderr = execError.stderr?.toString("utf-8") || "";
        throw new S3Error(
          `Failed to upload latest.json: ${stderr || execError.message}`,
          "upload"
        );
      }
    });

    yield* Console.log("  -> Uploaded: updates/latest.json");
  });

const uploadArtifacts = (
  arch: "aarch64" | "x64",
  config: ReleaseConfig
): Effect.Effect<void, S3Error | BuildError> =>
  Effect.gen(function* () {
    const target = arch === "aarch64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
    const platformKey = arch === "aarch64" ? "darwin-aarch64" : "darwin-x86_64";

    const bundleDir = Path.join(
      config.repoRoot,
      `packages/desktop/src-tauri/target/${target}/release/bundle`
    );
    const dmgDir = Path.join(bundleDir, "dmg");
    const macosDir = Path.join(bundleDir, "macos");

    yield* Console.log(`\nUploading artifacts for ${arch}...`);

    // Find and upload DMG
    const dmgPath = yield* findDMG(dmgDir);
    yield* uploadToS3(dmgPath, `v${config.version}/Acepe_${arch}.dmg`, config);
    yield* uploadToS3(dmgPath, `latest/Acepe_${arch}.dmg`, config);

    // Check for updater bundle
    const appBundle = Path.join(macosDir, "Acepe.app.tar.gz");
    const appSig = Path.join(macosDir, "Acepe.app.tar.gz.sig");

    const bundleExists = yield* Effect.tryPromise({
      try: async () => {
        try {
          await Fs.access(appBundle);
          await Fs.access(appSig);
          return true;
        } catch {
          return false;
        }
      },
      catch: () => false
    }).pipe(
      Effect.orElseSucceed(() => false)
    );

    if (bundleExists) {
      yield* Console.log(`  Found updater bundle for ${arch}`);

      // Upload updater bundle
      yield* uploadToS3(appBundle, `v${config.version}/Acepe_${arch}.app.tar.gz`, config);
      yield* uploadToS3(appSig, `v${config.version}/Acepe_${arch}.app.tar.gz.sig`, config);

      // Read signature
      const signature = yield* Effect.tryPromise({
        try: () => Fs.readFile(appSig, "utf-8"),
        catch: () => ""
      }).pipe(
        Effect.orElseSucceed(() => "")
      );

      // Update latest.json
      const existingJson = yield* readLatestJson(config);
      const pubDate = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

      const updatedJson: LatestJson = {
        version: config.version,
        pub_date: pubDate,
        platforms: {
          ...existingJson.platforms,
          [platformKey]: {
            signature: signature.trim(),
            url: `${config.cdnBaseUrl}/v${config.version}/Acepe_${arch}.app.tar.gz`
          }
        }
      };

      yield* uploadLatestJson(updatedJson, config);
      yield* Console.log(`  Updated latest.json with ${platformKey}`);
    } else {
      yield* Console.log(`  No updater bundle found for ${arch} (skipping auto-update)`);
    }

    yield* Console.log(`Upload complete for ${arch}`);
  });

// ============================================================================
// Main Release Flow
// ============================================================================

const loadConfig = (): Effect.Effect<ReleaseConfig, ConfigError> =>
  Effect.gen(function* () {
    const repoRoot = getRepoRoot();
    const envPath = Path.join(repoRoot, ".env.local");

    yield* Console.log("Loading configuration...");

    const env = yield* loadEnvFile(envPath);

    // Validate AWS credentials with format checking
    let awsAccessKeyId: string;
    let awsSecretAccessKey: string;

    try {
      awsAccessKeyId = validateAwsKey(
        env.RAILWAY_BUCKET_ACCESS_KEY || "",
        "RAILWAY_BUCKET_ACCESS_KEY"
      );
      awsSecretAccessKey = validateAwsKey(
        env.RAILWAY_BUCKET_SECRET_KEY || "",
        "RAILWAY_BUCKET_SECRET_KEY"
      );
    } catch (error) {
      if (error instanceof ConfigError) {
        return yield* Effect.fail(error);
      }
      throw error;
    }

    // Load signing key if available
    const signingKeyPath = Path.join(process.env.HOME || "", CONFIG.SIGNING_KEY_PATH);
    let signingKey = process.env.TAURI_SIGNING_PRIVATE_KEY;

    if (!signingKey) {
      const keyExists = yield* Effect.tryPromise({
        try: async () => {
          try {
            await Fs.access(signingKeyPath);
            return true;
          } catch {
            return false;
          }
        },
        catch: () => false
      }).pipe(
        Effect.orElseSucceed(() => false)
      );

      if (keyExists) {
        signingKey = yield* Effect.tryPromise({
          try: () => Fs.readFile(signingKeyPath, "utf-8"),
          catch: () => undefined
        }).pipe(
          Effect.orElseSucceed(() => undefined)
        );
      }
    }

    if (!signingKey) {
      yield* Console.log("Warning: No signing key found. Auto-updates will not work.");
    }

    // Load signing key password and analytics
    const sentryDsn = yield* resolveRequiredEnvVar("SENTRY_DSN", env);
    const viteSentryDsn = yield* resolveRequiredEnvVar("VITE_SENTRY_DSN", env);
    const mixpanelToken = env.MIXPANEL_TOKEN ?? process.env.MIXPANEL_TOKEN ?? "";
    const viteMixpanelToken = env.VITE_MIXPANEL_TOKEN ?? process.env.VITE_MIXPANEL_TOKEN ?? "";

    const signingKeyPassword = env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD || process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
    const appleSigningIdentity = env.APPLE_SIGNING_IDENTITY || process.env.APPLE_SIGNING_IDENTITY;
    const appleId = env.APPLE_ID || process.env.APPLE_ID;
    const applePassword = env.APPLE_PASSWORD || process.env.APPLE_PASSWORD;
    const appleTeamId = env.APPLE_TEAM_ID || process.env.APPLE_TEAM_ID;

    if (signingKey && !signingKeyPassword) {
      yield* Console.log("Warning: Signing key found but no password. Auto-updates may fail.");
    }
    if (!appleSigningIdentity || !appleTeamId) {
      yield* Console.log("Warning: APPLE_SIGNING_IDENTITY or APPLE_TEAM_ID missing. Code signing may fail.");
    }
    if (!appleId || !applePassword) {
      yield* Console.log("Warning: APPLE_ID or APPLE_PASSWORD missing. Notarization may fail.");
    }

    return {
      version: "", // Will be set later
      bucket: CONFIG.BUCKET,
      endpoint: CONFIG.ENDPOINT,
      cdnBaseUrl: CONFIG.CDN_BASE_URL,
      awsAccessKeyId,
      awsSecretAccessKey,
      awsRegion: CONFIG.REGION,
      sentryDsn,
      viteSentryDsn,
      mixpanelToken,
      viteMixpanelToken,
      signingKey,
      signingKeyPassword,
      appleSigningIdentity,
      appleId,
      applePassword,
      appleTeamId,
      repoRoot
    };
  });

const program = Effect.gen(function* () {
  // Print header
  yield* Console.log("");
  yield* Console.log("===================================");
  yield* Console.log("     ACEPE RELEASE MANAGER");
  yield* Console.log("===================================");
  yield* Console.log("");

  // Load config
  const config = yield* loadConfig();

  // Generate version
  const version = yield* generateVersion();
  yield* Console.log(`\nReleasing version: v${version}\n`);

  // Check working directory
  yield* Console.log("1. Checking prerequisites...");
  const isClean = yield* checkWorkingDirectory(config.repoRoot);

  if (!isClean) {
    yield* Console.log("\nUncommitted changes detected!");
    yield* Console.log("   Please choose how to proceed:\n");

    const choice = yield* Effect.tryPromise({
      try: () => select({
        message: "What would you like to do?",
        choices: [
          { name: "Stash changes and continue", value: "stash" },
          { name: "Commit all changes and continue", value: "commit" },
          { name: "Abort release", value: "abort" }
        ]
      }),
      catch: () => "abort"
    });

    if (choice === "abort") {
      yield* Console.log("\nRelease aborted by user");
      process.exit(0);
    } else if (choice === "stash") {
      yield* Console.log("\nStashing changes...");
      yield* execCommand("git stash push -m 'release-script-stash'", { cwd: config.repoRoot });
      yield* Console.log("Changes stashed\n");
    } else if (choice === "commit") {
      yield* Console.log("\nCommitting changes...");
      yield* execCommand("git add -A", { cwd: config.repoRoot });
      yield* execCommand("git commit -m 'chore: pre-release changes'", { cwd: config.repoRoot });
      yield* Console.log("Changes committed\n");
    }
  }

  // Update version (commit needed before build, but tag deferred until builds succeed)
  yield* Console.log("\n2. Updating version...");
  yield* updateTauriConfig(version, config.repoRoot);
  yield* commitVersionBump(version, config.repoRoot);

  // Build
  yield* Console.log("\n3. Building ACPs...");
  yield* buildACPs(config.repoRoot);

  // Sign vendor binaries before Tauri bundles them
  yield* Console.log("\n3b. Signing vendor binaries...");
  yield* signVendorBinaries(config.repoRoot, config.appleSigningIdentity);

  // Build and upload Apple Silicon
  yield* Console.log("\n4. Building Apple Silicon...");
  yield* buildTauri(
    "aarch64",
    config.repoRoot,
    config.sentryDsn,
    config.viteSentryDsn,
    config.mixpanelToken,
    config.viteMixpanelToken,
    config.signingKey,
    config.signingKeyPassword,
    config.appleSigningIdentity,
    config.appleId,
    config.applePassword,
    config.appleTeamId
  );

  if (!config.appleTeamId) {
    return yield* Effect.fail(
      new BuildError("APPLE_TEAM_ID is required for release signing verification")
    );
  }
  if (!config.appleSigningIdentity) {
    return yield* Effect.fail(
      new BuildError("APPLE_SIGNING_IDENTITY is required for release signing verification")
    );
  }

  yield* Console.log("\n4b. Verifying macOS signing...");
  yield* verifyMacBundleSigning(config.repoRoot, "aarch64", config.appleTeamId, {
    appleSigningIdentity: config.appleSigningIdentity,
    // This runs after `tauri build` notarizes/staples. Re-signing here can invalidate notarization.
    allowResignRepair: false,
  });

  // Tag only after all builds succeed
  yield* Console.log("\n5. Creating release tag...");
  yield* createGitTag(version, config.repoRoot);

  yield* Console.log("\n6. Uploading Apple Silicon artifacts...");
  yield* uploadArtifacts("aarch64", { ...config, version });

  // Push to remote
  yield* Console.log("\n7. Pushing to remote...");
  yield* pushToRemote(version, config.repoRoot);

  // Success
  yield* Console.log("");
  yield* Console.log("===================================");
  yield* Console.log("");
  yield* Console.log(`Release complete! Version v${version} is now live`);
  yield* Console.log("");
  yield* Console.log("===================================");
  yield* Console.log("");
});

// Run with error handling
program.pipe(
  Effect.catchAll((error) => {
    return Effect.gen(function* () {
      yield* Console.log("");
      yield* Console.log("Release failed:");

      // Handle both string errors and Error objects
      const errorMessage = typeof error === "string" ? error : error.message;
      yield* Console.log(`   ${errorMessage}`);
      yield* Console.log("");

      if (error instanceof GitError) {
        if (error.command) {
          yield* Console.log(`   Command: ${error.command}`);
        }
        if (error.stderr) {
          yield* Console.log(`   Stderr: ${error.stderr.slice(-500)}`);
        }
      }

      if (error instanceof BuildError && error.output) {
        yield* Console.log(`   Output: ${error.output.slice(-1000)}`);
      }

      if (error instanceof S3Error && error.key) {
        yield* Console.log(`   S3 Key: ${error.key}`);
      }

      if (error instanceof ConfigError && error.value) {
        yield* Console.log(`   Value: ${error.value}`);
      }

      yield* Console.log("");
      process.exit(1);
    });
  }),
  Effect.runPromise
);
