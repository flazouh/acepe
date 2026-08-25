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

// 6581 -> 6583: two new `it("...", async () => {})` tests added in
// scene-content-viewport.svelte.vitest.ts trip effect(asyncFunction), same
// as every other test in that file already does.
// 6583 -> 6584: one `new Date()` test-fixture helper added in
// first-send-activation.test.ts trips effect(globalDate).
// 6584 -> 6586: one new `it("...", async () => {})` regression test added in
// initialization-manager.test.ts (scanStartupSessionHistory defect
// resilience) trips effect(asyncFunction), plus its `new Date()` project
// fixture trips effect(globalDate) -- same pattern every other test in that
// describe block already has.
// 6586 -> 6593: colocated library-store.vitest.ts (new file, covering the
// first-run skill-import fix) has a `beforeEach` and three `it` callbacks
// declared `async`, tripping effect(asyncFunction) four times, plus three
// `Effect.runPromise(Effect.result(store.initialize()))` call sites that
// have a pipeable form, tripping effect(missedPipeableOpportunity) three
// times. Same category as the bumps above -- test-file async/pipe style,
// not production code.
// 6593 -> 6597: four new `it("...", async () => {})` tests added in
// reopened-session-hydrator.test.ts trip effect(asyncFunction), same
// as every other test in that file already does.
// 6597 -> 6600: sidebar-restart fix (union library-projected projects into
// ProjectManager, closing the gap where scanSessionProjections widened the
// session list but never the project list it's filtered against). One new
// `it("...", async () => {})` regression test in initialization-manager.test.ts
// trips effect(asyncFunction), plus its `new Date()` project fixture trips
// effect(globalDate) (same pattern as the 6584 -> 6586 bump above); one new
// `new Date(iso)` expectation fixture in project-manager.test.ts trips
// effect(globalDate) too. All three are test-file style, not production code.
// 6600 -> 6579: the Tauri/Rust removal (3ba1a1639..986b03cd4) deleted
// desktop files that carried violations. NOTE: the count includes svelte-kit
// generated files, so run after `svelte-kit sync`/a build for a stable read.
const BASELINE = 6579;
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
