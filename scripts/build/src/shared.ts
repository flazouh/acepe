import { Effect, Console } from "effect";
import * as Fs from "node:fs/promises";
import * as Path from "node:path";
import { execSync, spawn, spawnSync } from "node:child_process";

// ============================================================================
// Constants
// ============================================================================

export const CONFIG = {
  BUCKET: "optimized-bin-6nmqyetcvkn",
  ENDPOINT: "https://storage.railway.app",
  REGION: "us-west-2",
  CDN_BASE_URL: process.env.ACEPE_CDN_URL || "https://bucket-proxy-production.up.railway.app",
  SIGNING_KEY_PATH: ".tauri/acepe.key",
  TAURI_CONFIG_PATH: "packages/desktop/src-tauri/tauri.conf.json",
  DESKTOP_PACKAGE_PATH: "packages/desktop",
  ACPS: {
    CLAUDE: "packages/acps/claude"
  }
} as const;

// ============================================================================
// Error Types
// ============================================================================

export class GitError extends Error {
  readonly _tag = "GitError";
  constructor(
    message: string,
    readonly command?: string,
    readonly stderr?: string
  ) {
    super(message);
  }
}

export class BuildError extends Error {
  readonly _tag = "BuildError";
  constructor(
    message: string,
    readonly arch?: string,
    readonly output?: string
  ) {
    super(message);
  }
}

export class S3Error extends Error {
  readonly _tag = "S3Error";
  constructor(
    message: string,
    readonly operation?: string,
    readonly key?: string
  ) {
    super(message);
  }
}

export class ConfigError extends Error {
  readonly _tag = "ConfigError";
  constructor(
    message: string,
    readonly key?: string,
    readonly value?: string
  ) {
    super(message);
  }
}

export class VersionError extends Error {
  readonly _tag = "VersionError";
  constructor(message: string) {
    super(message);
  }
}

export interface CodesignDisplayInfo {
  readonly executable?: string;
  readonly identifier?: string;
  readonly teamIdentifier?: string | null;
  readonly authorities: readonly string[];
  readonly notarizationTicketStapled: boolean;
  readonly rawOutput: string;
}

export interface MacSigningVerificationReport {
  readonly arch: "aarch64" | "x64";
  readonly target: string;
  readonly appPath: string;
  readonly app: CodesignDisplayInfo;
  readonly mainExecutable: CodesignDisplayInfo;
}

// ============================================================================
// Utilities
// ============================================================================

export const execCommand = (command: string, options?: { cwd?: string; env?: Record<string, string> }): Effect.Effect<string, GitError> =>
  Effect.try({
    try: () => {
      const result = execSync(command, {
        cwd: options?.cwd,
        env: { ...process.env, ...options?.env },
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"]
      });
      return result;
    },
    catch: (error) => {
      const execError = error as { stderr?: Buffer; message: string };
      const stderr = execError.stderr?.toString("utf-8") || "";
      return new GitError(
        `Command failed: ${command}\n${stderr || execError.message}`,
        command,
        stderr
      );
    }
  });

export const execCommandWithOutput = (
  command: string,
  args: string[],
  options?: { cwd?: string; env?: Record<string, string> }
): Effect.Effect<void, BuildError> =>
  Effect.async((resume) => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const child = spawn(command, args, {
      cwd: options?.cwd,
      env: { ...process.env, ...options?.env },
      stdio: ["pipe", "pipe", "pipe"]
    });

    child.stdout?.on("data", (data) => {
      const str = data.toString("utf-8");
      stdout.push(str);
      process.stdout.write(str);
    });

    child.stderr?.on("data", (data) => {
      const str = data.toString("utf-8");
      stderr.push(str);
      process.stderr.write(str);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resume(Effect.void);
      } else {
        const output = [...stdout, ...stderr].join("\n");
        resume(Effect.fail(new BuildError(
          `Build failed with code ${code}. Output:\n${output.slice(-2000)}`,
          undefined,
          output
        )));
      }
    });

    child.on("error", (error) => {
      resume(Effect.fail(new BuildError(`Failed to spawn process: ${error.message}`)));
    });
  });

export const loadEnvFile = (path: string): Effect.Effect<Record<string, string>, ConfigError> =>
  Effect.tryPromise({
    try: async () => {
      const content = await Fs.readFile(path, "utf-8");
      const env: Record<string, string> = {};
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          const [key, ...valueParts] = trimmed.split("=");
          if (key && valueParts.length > 0) {
            env[key] = valueParts.join("=").trim();
          }
        }
      }
      return env;
    },
    catch: (error) => new ConfigError(`Failed to load env file: ${path}`, path)
  });

export const resolveRequiredEnvVar = (
  name: string,
  loadedEnv: Readonly<Record<string, string>>
): Effect.Effect<string, ConfigError> =>
  Effect.gen(function* () {
    const value = loadedEnv[name] || process.env[name] || "";
    const trimmed = value.trim();
    if (!trimmed) {
      return yield* Effect.fail(
        new ConfigError(
          `${name} is required for desktop analytics. Set it in .env.local or your shell environment.`,
          name
        )
      );
    }
    return trimmed;
  });

export const parseCodesignDisplayOutput = (output: string): CodesignDisplayInfo => {
  const lines = output.split(/\r?\n/);

  let executable: string | undefined;
  let identifier: string | undefined;
  let teamIdentifier: string | null | undefined;
  const authorities: string[] = [];
  let notarizationTicketStapled = false;

  for (const line of lines) {
    if (line.startsWith("Executable=")) {
      executable = line.slice("Executable=".length).trim();
      continue;
    }
    if (line.startsWith("Identifier=")) {
      identifier = line.slice("Identifier=".length).trim();
      continue;
    }
    if (line.startsWith("TeamIdentifier=")) {
      const raw = line.slice("TeamIdentifier=".length).trim();
      teamIdentifier = raw === "not set" ? null : raw;
      continue;
    }
    if (line.startsWith("Authority=")) {
      authorities.push(line.slice("Authority=".length).trim());
      continue;
    }
    if (line === "Notarization Ticket=stapled") {
      notarizationTicketStapled = true;
    }
  }

  return {
    executable,
    identifier,
    teamIdentifier,
    authorities,
    notarizationTicketStapled,
    rawOutput: output
  };
};

export const validateMacSigningInfo = (
  report: {
    readonly app: CodesignDisplayInfo;
    readonly mainExecutable: CodesignDisplayInfo;
    readonly expectedTeamId: string;
    readonly expectedAppIdentifier: string;
  }
): string[] => {
  const errors: string[] = [];

  const entries = [
    ["app", report.app],
    ["main executable", report.mainExecutable]
  ] as const;

  for (const [label, info] of entries) {
    if (info.teamIdentifier && info.teamIdentifier !== report.expectedTeamId) {
      errors.push(
        `${label}: TeamIdentifier '${info.teamIdentifier}' does not match expected '${report.expectedTeamId}'`
      );
    }
  }

  for (const [label, info] of entries) {
    if (!info.authorities.some((authority) => authority.startsWith("Developer ID Application: "))) {
      errors.push(`${label}: missing Developer ID Application authority in codesign metadata`);
    }
  }

  if (!report.app.notarizationTicketStapled) {
    errors.push("app: notarization ticket is not stapled");
  }

  if (report.app.identifier !== report.expectedAppIdentifier) {
    errors.push(
      `app: Identifier '${report.app.identifier ?? "<missing>"}' does not match expected '${report.expectedAppIdentifier}'`
    );
  }

  if (report.mainExecutable.identifier !== report.expectedAppIdentifier) {
    errors.push(
      `main executable: Identifier '${report.mainExecutable.identifier ?? "<missing>"}' does not match expected '${report.expectedAppIdentifier}'`
    );
  }

  return errors;
};

const runCommandCapture = (
  command: string,
  args: string[],
  options?: { cwd?: string; env?: Record<string, string> }
): Effect.Effect<string, BuildError> =>
  Effect.try({
    try: () => {
      const result = spawnSync(command, args, {
        cwd: options?.cwd,
        env: { ...process.env, ...options?.env },
        encoding: "utf-8"
      });

      const stdout = result.stdout ?? "";
      const stderr = result.stderr ?? "";
      const output = [stdout, stderr].filter(Boolean).join("");

      if (typeof result.status === "number" && result.status !== 0) {
        throw new BuildError(
          `Command failed (${result.status}): ${command} ${args.join(" ")}\n${output.slice(-4000)}`,
          undefined,
          output
        );
      }

      return output;
    },
    catch: (error) => {
      if (error instanceof BuildError) {
        return error;
      }
      const message = error instanceof Error ? error.message : String(error);
      return new BuildError(`Failed to run ${command}: ${message}`);
    }
  });

// ============================================================================
// Code Signing
// ============================================================================

export const signVendorBinaries = (
  repoRoot: string,
  appleSigningIdentity: string | undefined
): Effect.Effect<void, BuildError> =>
  Effect.gen(function* () {
    if (!appleSigningIdentity) {
      yield* Console.log("  -> Skipping vendor binary signing (no signing identity)");
      return;
    }

    const vendorDir = Path.join(
      repoRoot,
      "packages/acps/claude/node_modules/@anthropic-ai/claude-agent-sdk/vendor/ripgrep"
    );

    const darwinDirs = ["arm64-darwin", "x64-darwin"];

    for (const dir of darwinDirs) {
      const dirPath = Path.join(vendorDir, dir);

      const files = yield* Effect.tryPromise({
        try: () => Fs.readdir(dirPath),
        catch: () => [] as string[]
      }).pipe(
        Effect.orElseSucceed(() => [] as string[])
      );

      for (const file of files) {
        const filePath = Path.join(dirPath, file);
        yield* Console.log(`  -> Signing ${dir}/${file}...`);
        yield* execCommandWithOutput(
          "codesign",
          [
            "--force",
            "--options", "runtime",
            "--sign", appleSigningIdentity,
            "--timestamp",
            filePath
          ],
          { cwd: repoRoot }
        );
      }
    }

    // Sign the claude-agent-acp binary
    const acpBinaryPath = Path.join(repoRoot, CONFIG.ACPS.CLAUDE, "dist", "claude-agent-acp");
    const acpExists = yield* Effect.tryPromise({
      try: async () => {
        await Fs.access(acpBinaryPath);
        return true;
      },
      catch: () => false
    }).pipe(Effect.orElseSucceed(() => false));

    if (acpExists) {
      const acpEntitlements = Path.join(repoRoot, CONFIG.ACPS.CLAUDE, "Entitlements.plist");
      yield* Console.log("  -> Signing claude-agent-acp binary...");
      yield* execCommandWithOutput(
        "codesign",
        [
          "--force",
          "--options", "runtime",
          "--sign", appleSigningIdentity,
          "--timestamp",
          "--entitlements", acpEntitlements,
          acpBinaryPath
        ],
        { cwd: repoRoot }
      );
    } else {
      yield* Console.log("  -> Warning: claude-agent-acp binary not found, skipping signing");
    }

    yield* Console.log("Vendor binaries signed successfully");
  });

const macTargetForArch = (arch: "aarch64" | "x64"): string =>
  arch === "aarch64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";

const macBundleRootForArch = (repoRoot: string, arch: "aarch64" | "x64"): string =>
  Path.join(repoRoot, "packages/desktop/src-tauri/target", macTargetForArch(arch), "release", "bundle");

const findMacAppBundle = (macosDir: string): Effect.Effect<string, BuildError> =>
  Effect.gen(function* () {
    const entries = yield* Effect.tryPromise({
      try: () => Fs.readdir(macosDir),
      catch: () => new BuildError(`Failed to read macOS bundle directory: ${macosDir}`)
    });

    const appName = entries.find((entry) => entry.endsWith(".app"));
    if (!appName) {
      return yield* Effect.fail(new BuildError(`No .app bundle found in ${macosDir}`));
    }

    return Path.join(macosDir, appName);
  });

const formatSigningReport = (
  report: MacSigningVerificationReport,
  expectedTeamId: string
): string => {
  const lines = [
    `arch=${report.arch}`,
    `target=${report.target}`,
    `expectedTeamId=${expectedTeamId}`,
    `appPath=${report.appPath}`,
    "",
    `[app bundle]`,
    `identifier=${report.app.identifier ?? "<missing>"}`,
    `teamIdentifier=${report.app.teamIdentifier ?? "<missing>"}`,
    `authorities=${report.app.authorities.join(" | ") || "<missing>"}`,
    `notarizationTicketStapled=${report.app.notarizationTicketStapled}`,
    `executable=${report.app.executable ?? "<missing>"}`,
    "",
    `[main executable]`,
    `identifier=${report.mainExecutable.identifier ?? "<missing>"}`,
    `teamIdentifier=${report.mainExecutable.teamIdentifier ?? "<missing>"}`,
    `authorities=${report.mainExecutable.authorities.join(" | ") || "<missing>"}`,
    `notarizationTicketStapled=${report.mainExecutable.notarizationTicketStapled}`,
    `executable=${report.mainExecutable.executable ?? "<missing>"}`,
    ""
  ];

  return lines.join("\n");
};

const writeSigningReport = (
  repoRoot: string,
  report: MacSigningVerificationReport,
  expectedTeamId: string
): Effect.Effect<void, BuildError> =>
  Effect.tryPromise({
    try: async () => {
      const bundleRoot = macBundleRootForArch(repoRoot, report.arch);
      const reportPath = Path.join(bundleRoot, `signing-report-${report.arch}.txt`);
      await Fs.writeFile(reportPath, formatSigningReport(report, expectedTeamId), "utf-8");
    },
    catch: (error) =>
      new BuildError(
        `Failed to write signing report: ${error instanceof Error ? error.message : String(error)}`
      )
  });

const collectMacSigningReport = (
  repoRoot: string,
  arch: "aarch64" | "x64"
): Effect.Effect<MacSigningVerificationReport, BuildError> =>
  Effect.gen(function* () {
    const target = macTargetForArch(arch);
    const bundleRoot = macBundleRootForArch(repoRoot, arch);
    const macosDir = Path.join(bundleRoot, "macos");
    const appPath = yield* findMacAppBundle(macosDir);
    const mainExecutablePath = Path.join(appPath, "Contents", "MacOS", "acepe");

    yield* runCommandCapture("codesign", ["--verify", "--deep", "--strict", appPath]);

    const appCodesignOutput = yield* runCommandCapture("codesign", ["-dvv", appPath]);
    const mainExecutableOutput = yield* runCommandCapture("codesign", ["-dvv", mainExecutablePath]);

    return {
      arch,
      target,
      appPath,
      app: parseCodesignDisplayOutput(appCodesignOutput),
      mainExecutable: parseCodesignDisplayOutput(mainExecutableOutput)
    };
  });

const explicitResignMacBundle = (
  repoRoot: string,
  arch: "aarch64" | "x64",
  appleSigningIdentity: string
): Effect.Effect<void, BuildError> =>
  Effect.gen(function* () {
    const bundleRoot = macBundleRootForArch(repoRoot, arch);
    const macosDir = Path.join(bundleRoot, "macos");
    const appPath = yield* findMacAppBundle(macosDir);
    const appEntitlements = Path.join(repoRoot, "packages/desktop/src-tauri/Entitlements.plist");

    // ACPs are no longer bundled — only re-sign the app bundle itself.
    yield* Console.log("  -> Re-signing app bundle (final sign)...");
    yield* execCommandWithOutput(
      "codesign",
      [
        "--force",
        "--options", "runtime",
        "--sign", appleSigningIdentity,
        "--timestamp",
        "--entitlements", appEntitlements,
        appPath
      ],
      { cwd: repoRoot }
    );
  });

export const verifyMacBundleSigning = (
  repoRoot: string,
  arch: "aarch64" | "x64",
  expectedTeamId: string,
  options?: {
    readonly appleSigningIdentity?: string;
    readonly allowResignRepair?: boolean;
    readonly expectedAppIdentifier?: string;
  }
): Effect.Effect<MacSigningVerificationReport, BuildError> =>
  Effect.gen(function* () {
    const expectedAppIdentifier = options?.expectedAppIdentifier ?? "com.alex.acepe";
    const allowResignRepair = options?.allowResignRepair ?? false;

    const evaluateReport = (
      report: MacSigningVerificationReport
    ): Effect.Effect<MacSigningVerificationReport, BuildError> =>
      Effect.gen(function* () {
        const errors = validateMacSigningInfo({
          app: report.app,
          mainExecutable: report.mainExecutable,
          expectedTeamId,
          expectedAppIdentifier
        });

        yield* writeSigningReport(repoRoot, report, expectedTeamId);

        yield* Console.log("  -> Signing verification summary:");
        yield* Console.log(
          `     app=${report.app.identifier ?? "<missing>"} team=${report.app.teamIdentifier ?? "<missing>"}`
        );
        yield* Console.log(
          `     main=${report.mainExecutable.identifier ?? "<missing>"} team=${report.mainExecutable.teamIdentifier ?? "<missing>"}`
        );

        if (errors.length > 0) {
          return yield* Effect.fail(
            new BuildError(
              `macOS signing verification failed (${arch}):\n${errors.map((e) => `- ${e}`).join("\n")}`
            )
          );
        }

        return report;
      });

    const initialReport = yield* collectMacSigningReport(repoRoot, arch);
    const firstAttempt = yield* evaluateReport(initialReport).pipe(
      Effect.either
    );

    if (firstAttempt._tag === "Right") {
      return firstAttempt.right;
    }

    if (!allowResignRepair || !options?.appleSigningIdentity) {
      return yield* Effect.fail(firstAttempt.left);
    }

    yield* Console.log(
      `  -> Signing verification failed for ${arch}, attempting explicit re-sign repair...`
    );
    yield* explicitResignMacBundle(repoRoot, arch, options.appleSigningIdentity);

    const repairedReport = yield* collectMacSigningReport(repoRoot, arch);
    return yield* evaluateReport(repairedReport);
  });

// ============================================================================
// Build Operations
// ============================================================================

/** Build the Claude ACP binary from source. Used by CI release workflow. */
export const buildClaudeACP = (repoRoot: string): Effect.Effect<void, BuildError> =>
  Effect.gen(function* () {
    yield* Console.log("  -> Building Claude ACP...");
    yield* execCommandWithOutput("bun", ["run", "build"], {
      cwd: Path.join(repoRoot, CONFIG.ACPS.CLAUDE)
    });

    yield* Console.log("  -> Compiling Claude ACP binary...");
    yield* execCommandWithOutput("bun", [
      "build", "src/static-entry.ts",
      "--compile",
      "--define", 'process.env.CLAUDE_AGENT_ACP_IS_SINGLE_FILE_BUN="true"',
      "--outfile", "dist/claude-agent-acp"
    ], {
      cwd: Path.join(repoRoot, CONFIG.ACPS.CLAUDE)
    });

    yield* Console.log("Claude ACP built successfully");
  });

export const buildTauri = (
  arch: "aarch64" | "x64",
  repoRoot: string,
  sentryDsn: string,
  viteSentryDsn: string,
  signingKey: string | undefined,
  signingKeyPassword: string | undefined,
  appleSigningIdentity: string | undefined,
  appleId: string | undefined,
  applePassword: string | undefined,
  appleTeamId: string | undefined
): Effect.Effect<string, BuildError> =>
  Effect.gen(function* () {
    const target = arch === "aarch64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";

    yield* Console.log(`Building Tauri for ${arch}...`);
    yield* Console.log(`   This may take a while...`);

    const env: Record<string, string> = {
      MACOSX_DEPLOYMENT_TARGET: "10.15",
      SENTRY_DSN: sentryDsn,
      VITE_SENTRY_DSN: viteSentryDsn
    };
    if (signingKey) {
      env.TAURI_SIGNING_PRIVATE_KEY = signingKey;
    }
    if (signingKeyPassword) {
      env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = signingKeyPassword;
    }
    if (appleSigningIdentity) {
      env.APPLE_SIGNING_IDENTITY = appleSigningIdentity;
    }
    if (appleId) {
      env.APPLE_ID = appleId;
    }
    if (applePassword) {
      env.APPLE_PASSWORD = applePassword;
    }
    if (appleTeamId) {
      env.APPLE_TEAM_ID = appleTeamId;
    }

    yield* execCommandWithOutput("bunx", ["tauri", "build", "--target", target], {
      cwd: Path.join(repoRoot, CONFIG.DESKTOP_PACKAGE_PATH),
      env
    });

    const dmgPath = Path.join(
      repoRoot,
      `packages/desktop/src-tauri/target/${target}/release/bundle/dmg`
    );

    yield* Console.log(`Build complete for ${arch}`);

    return dmgPath;
  });

export const findDMG = (bundleDir: string): Effect.Effect<string, BuildError> =>
  Effect.gen(function* () {
    const files = yield* Effect.tryPromise({
      try: () => Fs.readdir(bundleDir),
      catch: () => new BuildError(`Failed to read directory: ${bundleDir}`)
    });

    const dmgFile = files.find(f => f.endsWith(".dmg"));

    if (!dmgFile) {
      return yield* Effect.fail(new BuildError(`No DMG found in ${bundleDir}`));
    }

    return Path.join(bundleDir, dmgFile);
  });

export const getRepoRoot = (): string => Path.resolve(__dirname, "../../..");
