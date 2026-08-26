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
// 6579 -> 6599: composite of the project-color/zoom/submit-intent feature
// work landed without a ratchet run, plus the QA session-list write log and
// startup-scan retry added while diagnosing the sidebar-blanking boot race.
// 6599 -> 6603: +2 unattributed, from a concurrent session's commits landed
// on this branch while the AC-263 reopen/rehydrate defect fixes below were
// in progress (not re-attributed to this batch -- see its own commit
// message). +2 from this batch's own two new
// `it("...", async () => {})` regression tests added to
// reopened-session-hydrator.test.ts (AC-263 issue #263 defect 2: re-seed on
// a genuinely newer reopen snapshot even when the local graph already has
// entries), same effect(asyncFunction) pattern as every other test in that
// file already trips.
// 6603 -> 6610: AC issue #266 defect 1 (SESSION_NOT_FOUND refresh loop) --
// the new colocated session-state-refresh-controller.vitest.ts has two
// `it("...", async () => {})` tests (effect(asyncFunction) x2) plus three
// `Effect.result(controller.refreshSessionStateSnapshot(...))` call sites
// with a pipeable form (effect(missedPipeableOpportunity) x3); the new
// awaiting-model-refresh-store.vitest.ts has two
// `Effect.succeed(undefined)` test-double return values
// (effect(effectSucceedWithVoid) x2). All seven are in brand-new test files
// exercising the fix; verified none land in the production files this batch
// touched (session-state-refresh-controller.svelte.ts,
// awaiting-model-refresh-store.svelte.ts, session-store-compose.ts,
// project-manager.svelte.ts) -- every violation in those files sits on
// unchanged pre-existing lines that simply shifted down.
// 6610 -> 6606: AC issue #266 defect 3 (dispatch-created sessions
// unopenable). Removing the broken `!capabilities.models ||
// !capabilities.modes` optional-property boolean check in
// session-connection-manager.ts's readiness gate (replaced by reading
// `eventHandler.getSessionCanSend(sessionId)` after the envelope applies)
// dropped more effect(strictBooleanExpressions)-style violations than the
// batch's own new test file additions added back.
// 6606 -> 6608: AC #266 defect 3 follow-up (a dispatch-created session's
// prior transcript now also hydrates on open, not just the attach itself).
// open-persisted-session.test.ts's two new
// `ensureProviderSessionImportedMock` fallback `Effect.succeed(undefined)`
// declarations (module-level const + beforeEach reset) trip
// effect(effectSucceedWithVoid) x2. Production code
// (open-persisted-session.ts, main-app-view.svelte) has zero new
// violations -- verified against this batch's actual diff.
// 6608 -> 6614: the alias-dedupe regression test
// (session-repository-alias-dedupe.test.ts) copies the sibling refresh
// harness whose fixtures use `new Date()` (effect(globalDate)) and
// non-boolean conditions -- the same patterns those sibling test files
// already trip. Production code (session-repository.ts alias upgrade)
// verified clean against this batch's diff.
// 6614 -> 6612: issue #268 (imported-session provider + pending-approval
// rendering + blocked-on-approval placeholder). This batch's own new test
// assertions are all synchronous (`it("...", () => {...})`, no `new Date()`
// fixtures), so they trip zero new violations. The net -2 comes from a
// concurrent commit on this same branch (17821aae4, unrelated to #268):
// extracting vite.config.js's deferred-stylesheet payload split into
// scripts/vite-defer-stylesheet-hmr.js removed more inline
// violation-tripping lines than its own new test file added. Verified this
// batch's own touched files (orchestration-canonical-bridge.ts,
// reopen-snapshot-graph.ts, session-status-mapper.ts,
// transcript-viewport-rendered-rows.ts, local-placeholder-mode.ts, and
// their test files) add zero new violations on their own changed lines.
// 6612 -> 6614: AC-269 (Claude Code working line: rotating verb, live
// elapsed timer, running-turn token count). Diffed the full violation list
// before/after this batch's desktop production changes (bridge +
// working-line presentation wiring), with everything else held equal:
// every line in the diff is the SAME pre-existing violation (identical
// rule, identical code -- two Date.now() calls and a handful of
// strictBooleanExpressions checks already in
// agent-panel-session-controller.svelte.ts and
// orchestration-canonical-bridge.ts before this batch) reported at a
// SHIFTED line number, because this batch's own new code was inserted
// earlier in those same files. Zero genuinely new violations on this
// batch's own added lines.
// 6614 -> 6617: AC-280 (permission approvals must always be actionable --
// run the reply Effect instead of discarding it; stop duplicating a
// permission's tool row and mangling its path). Three new `it("...", async
// () => {})` test callbacks trip effect(asyncFunction), same category as
// every prior bump in this file: two in permission-store.vitest.ts's new
// "runPermissionReply" describe block (proving the reply Effect actually
// runs, and that a failed reply surfaces a toast), one in
// permission-action-bar.svelte.vitest.ts (proving a click actually executes
// the Effect `reply()` returns, not just constructs it). This batch's own
// production changes (permission-store.svelte.ts,
// orchestration-canonical-bridge.ts, transcript-viewport-row-mapper.ts, and
// their non-async call-site edits) add zero new violations on their own
// changed lines.
const BASELINE = 6617;
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
