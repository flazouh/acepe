/**
 * Minimal reactive stand-in for `SessionProjectionCore.getGraphRevision`,
 * used to test the transcript-rows bootstrap retry race in
 * `scene-content-viewport.svelte.vitest.ts`. Backed by a `$state` rune (the
 * same compile-time reactivity primitive `scene-content-viewport.svelte`
 * itself uses) rather than an npm-resolved `SvelteMap` instance, so reading
 * it inside the component's `$effect` is guaranteed to share the same
 * reactivity graph as the component under test.
 */
let revisions = $state<Record<string, { readonly graphRevision: number } | undefined>>({});

export function getGraphRevisionFixture(
	sessionId: string
): { readonly graphRevision: number } | null {
	return revisions[sessionId] ?? null;
}

export function setGraphRevisionFixture(
	sessionId: string,
	value: { readonly graphRevision: number }
): void {
	revisions[sessionId] = value;
}

export function resetGraphRevisionFixture(): void {
	revisions = {};
}
