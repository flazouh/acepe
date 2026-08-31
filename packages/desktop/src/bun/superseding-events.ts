/**
 * One window, one events subscription.
 *
 * The webview calls the `events` RPC once per page load, but a page reload
 * does not tell the Bun side anything: the previous pushEvents fiber kept
 * running forever, still pushing every event (and, on its first run, a full
 * replay) into the same window channel. Each reload therefore added another
 * concurrent pusher. Live evidence (2026-08-31, /tmp/acepe-app-primary.log):
 * 1.07M push lines, the same event pushed once per leaked fiber, and the
 * interleaved sequences tripping the client's RpcEventSequenceGapError --
 * which kills the fresh page's one stream, leaving the panel deaf to every
 * canonical event until the next reload started the cycle again.
 *
 * A new request supersedes the previous one: the old fiber is interrupted
 * before the new push starts. The window has exactly one live subscription,
 * so every event is pushed exactly once and the client's gapless-sequence
 * expectation holds by construction.
 */
import type * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

export function makeSupersedingEventsHandler(
	runFork: (effect: Effect.Effect<unknown, unknown>) => Fiber.RuntimeFiber<unknown, unknown>,
	makePush: (params: unknown) => Effect.Effect<unknown, unknown>
): (params: unknown) => undefined {
	let active: Fiber.RuntimeFiber<unknown, unknown> | null = null;
	return (params) => {
		const previous = active;
		if (previous !== null) {
			runFork(Fiber.interrupt(previous));
		}
		active = runFork(makePush(params));
		return undefined;
	};
}
