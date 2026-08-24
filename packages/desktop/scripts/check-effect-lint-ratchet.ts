#!/usr/bin/env bun
/**
 * Ratchet for the desktop @effect/language-service diagnostics (AC-051).
 *
 * The full violation count (~6.6k) is far too large to fix in one pass, so
 * `lint:effect` stays report-only for now. This ratchet freezes today's
 * count as a ceiling: a batch that adds violations fails the check, and a
 * batch that fixes violations must lower BASELINE to match — same as
 * check-tauri-client-importers.ts, except this ratchet is also honest in
 * the other direction: it fails when the count drops below BASELINE too, so
 * a fix can't silently coast on a stale ceiling.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const BASELINE = 6581;
const PACKAGE_ROOT = resolve(import.meta.dir, "..");

// The pretty formatter (the default, and what lint:effect:report uses) always
// colorizes, even when not attached to a TTY, so strip ANSI SGR sequences
// before pattern-matching the summary line.
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escapes
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;
const SUMMARY_PATTERN = /(\d+)\s+errors?,\s+(\d+)\s+warnings?\s+and\s+(\d+)\s+messages?\./;

function run(): never {
	const result = spawnSync(
		"effect-language-service",
		["diagnostics", "--project", "tsconfig.json", "--strict"],
		{
			cwd: PACKAGE_ROOT,
			encoding: "utf8",
			maxBuffer: 1024 * 1024 * 128,
		}
	);

	if (result.error) {
		console.error(
			`check-effect-lint-ratchet: failed to run effect-language-service: ${result.error.message}`
		);
		process.exit(1);
	}

	// Diagnostics land on stdout; concatenate stderr too in case the CLI's
	// output split ever changes, and to surface it either way on failure.
	const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.replace(ANSI_PATTERN, "");
	const summary = SUMMARY_PATTERN.exec(output);

	if (!summary) {
		console.error(
			"check-effect-lint-ratchet: could not find the diagnostics summary line in output."
		);
		console.error("effect-language-service output may have changed format; update this script.");
		process.exit(1);
	}

	const violations = Number.parseInt(summary[1], 10);
	console.log(`desktop effect-lint violations: ${violations} (ratchet: ${BASELINE})`);

	if (violations > BASELINE) {
		console.error("REGRESSION: violation count rose above the ratchet.");
		console.error(
			`Fix the new violations, or if this batch intentionally trades some off, raise BASELINE in scripts/check-effect-lint-ratchet.ts to ${violations} and say why.`
		);
		process.exit(1);
	}

	if (violations < BASELINE) {
		console.error(`Violation count dropped below the ratchet (${violations} < ${BASELINE}).`);
		console.error(
			`Lower BASELINE in scripts/check-effect-lint-ratchet.ts to ${violations} so the ratchet stays honest.`
		);
		process.exit(1);
	}

	process.exit(0);
}

run();
