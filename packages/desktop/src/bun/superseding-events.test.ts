import { describe, expect, it } from "bun:test";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";

import { makeSupersedingEventsHandler } from "./superseding-events.ts";

/**
 * The leak this guards against: every page reload requested `events` again,
 * the previous push fiber was never interrupted, and each leaked fiber kept
 * pushing every event into the one window channel -- multiplied pushes whose
 * interleaved sequences killed the fresh page's stream with a gap error, so
 * the panel stopped rendering live events entirely. See
 * superseding-events.ts's header for the live evidence.
 */
describe("makeSupersedingEventsHandler", () => {
	it("interrupts the previous subscription's push when a new request arrives", async () => {
		const interruptions: string[] = [];
		const started: string[] = [];

		const makePush = (params: unknown): Effect.Effect<unknown, unknown> =>
			Effect.gen(function* () {
				const label = String((params as { label: string }).label);
				started.push(label);
				const never = yield* Deferred.make<void>();
				yield* Deferred.await(never);
			}).pipe(
				Effect.onInterrupt(() =>
					Effect.sync(() => {
						interruptions.push(String((params as { label: string }).label));
					})
				)
			);

		const handler = makeSupersedingEventsHandler(
			(effect) => Effect.runFork(effect),
			makePush
		);

		handler({ label: "page-load-1" });
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(started).toEqual(["page-load-1"]);
		expect(interruptions).toEqual([]);

		handler({ label: "page-load-2" });
		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(started).toEqual(["page-load-1", "page-load-2"]);
		expect(interruptions).toEqual(["page-load-1"]);
	});
});
