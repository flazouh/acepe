import { expect, it } from "bun:test";
import type { RpcClient } from "@acepe/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { appRpcClient, setAppRpcClientForTest } from "./app-client.ts";

const fake: RpcClient = {
	dispatch: () => Effect.succeed({ sequence: 1 }),
	snapshot: () => Effect.die("unused"),
	getProjectIndex: () => Effect.die("unused"),
	invalidateProjectIndex: () => Effect.void,
	events: () => Stream.empty,
};

it("returns the injected client and memoises it", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			setAppRpcClientForTest(fake);
			const first = yield* appRpcClient();
			const second = yield* appRpcClient();
			expect(first).toBe(fake);
			expect(second).toBe(first);
			setAppRpcClientForTest(null);
		}),
	));
