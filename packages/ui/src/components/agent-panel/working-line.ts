/**
 * AC-269: pure presentation helpers for the Claude Code working line -- the
 * rotating-verb + elapsed-timer + token-count row that renders beside the
 * spark while a turn runs, e.g. "Puzzling... (12s * up 1.4k tokens * ctrl+c
 * to interrupt)".
 *
 * Deliberately a curated, Acepe-flavored verb list rather than a copy of
 * Claude Code's own rotation -- same playful register, different words.
 * Claude-code sessions get the richer list; every other provider gets a
 * smaller, calmer set (see selectWorkingLineVerbs).
 */

export const WORKING_LINE_VERBS_CLAUDE: readonly string[] = [
	"Composing",
	"Threading",
	"Weighing",
	"Charting",
	"Sketching",
	"Assembling",
	"Untangling",
	"Calibrating",
	"Surveying",
	"Mapping",
	"Distilling",
	"Kneading",
	"Layering",
	"Piecing together",
	"Sifting",
	"Steering",
	"Tuning",
	"Framing",
	"Anchoring",
	"Bridging",
] as const;

export const WORKING_LINE_VERBS_NEUTRAL: readonly string[] = [
	"Working",
	"Thinking",
	"Processing",
	"Responding",
	"Generating",
] as const;

/** How often the displayed verb rotates while a turn is running. */
export const WORKING_LINE_VERB_ROTATE_MS = 3000;

/**
 * Deterministic 32-bit string hash (djb2 variant) -- stable across renders
 * and processes, unlike Math.random or a counter that resets. Only used to
 * pick a starting offset into the verb list, so collision resistance does
 * not matter; determinism does.
 */
function hashSeed(seed: string): number {
	let hash = 5381;
	for (let index = 0; index < seed.length; index += 1) {
		hash = (hash * 33) ^ seed.charCodeAt(index);
	}
	return hash >>> 0;
}

/**
 * Picks the verb to display for a turn at a given elapsed time. Seeded by
 * `seed` (typically the turn id, or any other stable-per-turn value like its
 * start timestamp) so two renders of the SAME turn at the SAME elapsed time
 * always agree -- no reshuffling on re-render -- while two different turns
 * usually start from a different point in the list. Returns null when there
 * is no verb list to choose from (defensive; callers always pass a
 * non-empty list in practice).
 */
export function selectWorkingLineVerb(input: {
	readonly seed: string | number | null;
	readonly elapsedMs: number;
	readonly verbs: readonly string[];
}): string | null {
	if (input.verbs.length === 0) {
		return null;
	}
	const seedText = input.seed === null ? "" : String(input.seed);
	const offset = hashSeed(seedText);
	const clampedElapsedMs = Math.max(0, input.elapsedMs);
	const tick = Math.floor(clampedElapsedMs / WORKING_LINE_VERB_ROTATE_MS);
	const index = (offset + tick) % input.verbs.length;
	return input.verbs[index] ?? null;
}

/** Selects the verb list a provider's working line should rotate through. */
export function selectWorkingLineVerbs(isClaudeCode: boolean): readonly string[] {
	return isClaudeCode ? WORKING_LINE_VERBS_CLAUDE : WORKING_LINE_VERBS_NEUTRAL;
}

/**
 * Compact token-count formatting for the working line, e.g. 1400 -> "1.4k".
 * Mirrors the desktop app's model-selector token formatting (same visual
 * language) but kept local to packages/ui, which cannot import from the
 * desktop app.
 */
export function formatWorkingLineTokenCount(tokens: number): string {
	if (!Number.isFinite(tokens)) {
		return "0";
	}
	const clamped = Math.max(0, Math.round(tokens));
	if (clamped < 1000) {
		return `${clamped}`;
	}
	const units: ReadonlyArray<{ readonly value: number; readonly suffix: string }> = [
		{ value: 1_000_000_000, suffix: "b" },
		{ value: 1_000_000, suffix: "m" },
		{ value: 1_000, suffix: "k" },
	];
	for (const unit of units) {
		if (clamped >= unit.value) {
			const scaled = clamped / unit.value;
			const rounded = Number(scaled.toFixed(scaled >= 10 ? 0 : 1));
			return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded}${unit.suffix}`;
		}
	}
	return `${clamped}`;
}

/**
 * Elapsed-time formatting for the working line: "3s" under a minute,
 * "1m 12s" at or beyond it. Distinct from tool-duration.ts's
 * formatToolDurationLabel (seconds-only, tool calls are typically short) --
 * a turn can run for several minutes, and the working line needs to say so.
 */
export function formatWorkingLineElapsed(elapsedMs: number): string {
	const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
	if (totalSeconds < 60) {
		return `${totalSeconds}s`;
	}
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}m ${seconds}s`;
}

/**
 * Compact, directional token display for the working line, e.g. "up 1.4k
 * tokens" (rendered with an up-arrow glyph in the component; kept as a
 * literal "up" here so this stays plain-text testable). Null input means "no
 * real usage reading has arrived yet for this turn" -- callers must not
 * fabricate a zero, and this function has no fallback to fabricate one.
 */
export function formatWorkingLineTokens(tokens: number | null): string | null {
	if (tokens === null) {
		return null;
	}
	return `${formatWorkingLineTokenCount(tokens)} tokens`;
}

/**
 * Joins the elapsed/tokens/interrupt-hint pieces into the parenthetical, e.g.
 * "(12s * up 1.4k tokens * ctrl+c to interrupt)". Any piece the caller omits
 * (null) is left out entirely rather than shown empty -- in particular the
 * tokens piece must be null (not "0 tokens") until real usage data exists,
 * which formatWorkingLineTokens already guarantees. Returns null (no
 * parenthetical at all) when every piece is null.
 */
export function composeWorkingLineDetails(input: {
	readonly elapsed: string | null;
	readonly tokens: string | null;
	readonly interruptHint: string | null;
}): string | null {
	const pieces: string[] = [];
	if (input.elapsed !== null) {
		pieces.push(input.elapsed);
	}
	if (input.tokens !== null) {
		pieces.push(`↑ ${input.tokens}`);
	}
	if (input.interruptHint !== null) {
		pieces.push(input.interruptHint);
	}
	if (pieces.length === 0) {
		return null;
	}
	return `(${pieces.join(" · ")})`;
}

/**
 * Composes the full working-line text, e.g. "Puzzling... (12s * up 1.4k
 * tokens * ctrl+c to interrupt)". Returns null when there is no verb to
 * show (e.g. an empty verb list), so callers can fall back to their
 * existing static label instead of rendering nothing.
 */
export function composeWorkingLineText(input: {
	readonly verb: string | null;
	readonly details: string | null;
}): string | null {
	if (input.verb === null) {
		return null;
	}
	return input.details === null ? `${input.verb}…` : `${input.verb}… ${input.details}`;
}
