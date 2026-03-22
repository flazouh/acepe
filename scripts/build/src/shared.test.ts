import { describe, expect, test } from "bun:test";
import { Effect } from "effect";

import { parseCodesignDisplayOutput, resolveRequiredEnvVar, validateMacSigningInfo } from "./shared.js";

describe("parseCodesignDisplayOutput", () => {
  test("extracts identifier and team identifier", () => {
    const parsed = parseCodesignDisplayOutput(`
Executable=/Applications/Acepe.app/Contents/MacOS/acepe
Identifier=com.alex.acepe
Format=app bundle with Mach-O thin (arm64)
Authority=Developer ID Application: Ryan Roberts (VALZXQP6W5)
Notarization Ticket=stapled
TeamIdentifier=VALZXQP6W5
    `.trim());

    expect(parsed.executable).toBe("/Applications/Acepe.app/Contents/MacOS/acepe");
    expect(parsed.identifier).toBe("com.alex.acepe");
    expect(parsed.teamIdentifier).toBe("VALZXQP6W5");
    expect(parsed.authorities).toEqual(["Developer ID Application: Ryan Roberts (VALZXQP6W5)"]);
    expect(parsed.notarizationTicketStapled).toBeTrue();
  });

  test("maps TeamIdentifier=not set to null", () => {
    const parsed = parseCodesignDisplayOutput(`
Executable=/Applications/Acepe.app/Contents/Resources/acps/claude/claude-agent-acp
Identifier=claude-agent-acp
Authority=Developer ID Application: Ryan Roberts (VALZXQP6W5)
TeamIdentifier=not set
    `.trim());

    expect(parsed.identifier).toBe("claude-agent-acp");
    expect(parsed.teamIdentifier).toBeNull();
    expect(parsed.authorities).toEqual(["Developer ID Application: Ryan Roberts (VALZXQP6W5)"]);
    expect(parsed.notarizationTicketStapled).toBeFalse();
  });
});

describe("validateMacSigningInfo", () => {
  const mk = (
    identifier: string,
    teamIdentifier: string | null,
    overrides?: Partial<ReturnType<typeof parseCodesignDisplayOutput>>
  ) => ({
    identifier,
    teamIdentifier,
    authorities: ["Developer ID Application: Ryan Roberts (VALZXQP6W5)"],
    notarizationTicketStapled: false,
    rawOutput: "",
    executable: "/tmp/fake",
    ...overrides
  });

  test("does not fail when team identifier is missing", () => {
    const errors = validateMacSigningInfo({
      app: mk("com.alex.acepe", null, { notarizationTicketStapled: true }),
      mainExecutable: mk("com.alex.acepe", "VALZXQP6W5"),
      claudeAcpExecutable: mk("claude-agent-acp", "VALZXQP6W5"),
      expectedTeamId: "VALZXQP6W5",
      expectedAppIdentifier: "com.alex.acepe",
      expectedAcpIdentifier: "claude-agent-acp"
    });

    expect(errors).toEqual([]);
  });

  test("fails when team identifier mismatches expected", () => {
    const errors = validateMacSigningInfo({
      app: mk("com.alex.acepe", "WRONGTEAM"),
      mainExecutable: mk("com.alex.acepe", "VALZXQP6W5"),
      claudeAcpExecutable: mk("claude-agent-acp", "VALZXQP6W5"),
      expectedTeamId: "VALZXQP6W5",
      expectedAppIdentifier: "com.alex.acepe",
      expectedAcpIdentifier: "claude-agent-acp"
    });

    expect(errors.some((error) => error.includes("does not match expected"))).toBeTrue();
  });

  test("passes when identifiers and team IDs match", () => {
    const errors = validateMacSigningInfo({
      app: mk("com.alex.acepe", "VALZXQP6W5", { notarizationTicketStapled: true }),
      mainExecutable: mk("com.alex.acepe", "VALZXQP6W5"),
      claudeAcpExecutable: mk("claude-agent-acp", "VALZXQP6W5"),
      expectedTeamId: "VALZXQP6W5",
      expectedAppIdentifier: "com.alex.acepe",
      expectedAcpIdentifier: "claude-agent-acp"
    });

    expect(errors).toEqual([]);
  });

  test("fails when app bundle is not stapled", () => {
    const errors = validateMacSigningInfo({
      app: mk("com.alex.acepe", null, { notarizationTicketStapled: false }),
      mainExecutable: mk("com.alex.acepe", null),
      claudeAcpExecutable: mk("claude-agent-acp", null),
      expectedTeamId: "VALZXQP6W5",
      expectedAppIdentifier: "com.alex.acepe",
      expectedAcpIdentifier: "claude-agent-acp"
    });

    expect(errors.some((error) => error.includes("notarization ticket"))).toBeTrue();
  });
});

describe("resolveRequiredEnvVar", () => {
  test("prefers loaded env value", async () => {
    const value = await resolveRequiredEnvVar("SENTRY_DSN", {
      SENTRY_DSN: "loaded-token"
    }).pipe(Effect.runPromise);

    expect(value).toBe("loaded-token");
  });

  test("falls back to process.env value", async () => {
    const previousValue = process.env.SENTRY_DSN;
    process.env.SENTRY_DSN = "shell-token";
    const value = await resolveRequiredEnvVar("SENTRY_DSN", {}).pipe(Effect.runPromise);
    if (previousValue === undefined) {
      delete process.env.SENTRY_DSN;
    } else {
      process.env.SENTRY_DSN = previousValue;
    }

    expect(value).toBe("shell-token");
  });

  test("fails when env var is missing", async () => {
    delete process.env.SENTRY_DSN;

    const result = await Effect.runPromiseExit(resolveRequiredEnvVar("SENTRY_DSN", {}));

    expect(result._tag).toBe("Failure");
  });
});
