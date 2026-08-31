import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";

import { shareEventSource } from "../shared-event-source.js";

/**
 * The dual-subscription defect this guards against: EventSubscriber and
 * InboundRequestHandler each opened their own `events(0)` stream over the
 * one broadcast channel, so the page ran two interleaved full replays (one
 * of which died on the gap check) and two canonical bridges (with the reopen
 * realign landing on whichever registered last). The panel then dropped
 * every live canonical event until the next reload. See
 * shared-event-source.ts's header.
 */
describe("shareEventSource", () => {
	it("stands the underlying source up once and fans envelopes out to every subscriber", async () => {
		let opens = 0;
		let stops = 0;
		const emitter: { emit: (envelope: string) => void } = { emit: () => undefined };

		const shared = shareEventSource<string, Error>(
			(onEnvelope) =>
				Effect.sync(() => {
					opens += 1;
					emitter.emit = onEnvelope;
					return () => {
						stops += 1;
					};
				}),
			(error) => new Error(String(error))
		);

		const seenA: string[] = [];
		const seenB: string[] = [];
		const unlistenA = await Effect.runPromise(shared.open((envelope) => seenA.push(envelope)));
		const unlistenB = await Effect.runPromise(shared.open((envelope) => seenB.push(envelope)));

		expect(opens).toBe(1);

		emitter.emit("envelope-1");
		expect(seenA).toEqual(["envelope-1"]);
		expect(seenB).toEqual(["envelope-1"]);

		unlistenA();
		emitter.emit("envelope-2");
		expect(seenA).toEqual(["envelope-1"]);
		expect(seenB).toEqual(["envelope-1", "envelope-2"]);
		expect(stops).toBe(0);

		unlistenB();
		expect(stops).toBe(1);

		// A fresh subscriber after full teardown stands the source up again.
		const seenC: string[] = [];
		const unlistenC = await Effect.runPromise(shared.open((envelope) => seenC.push(envelope)));
		expect(opens).toBe(2);
		emitter.emit("envelope-3");
		expect(seenC).toEqual(["envelope-3"]);
		unlistenC();
		expect(stops).toBe(2);
	});

	it("propagates a standup failure to every waiting subscriber and detaches them", async () => {
		const shared = shareEventSource<string, Error>(
			() => Effect.fail(new Error("no transport")),
			(error) => (error instanceof Error ? error : new Error(String(error)))
		);

		const result = await Effect.runPromise(Effect.result(shared.open(() => undefined)));
		expect(result._tag).toBe("Failure");
	});
});
