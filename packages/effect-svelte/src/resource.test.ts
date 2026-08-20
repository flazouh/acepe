import { cleanup, render } from "@testing-library/svelte";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { flushSync } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import { resource } from "./resource.ts";
import ResourceHost from "./resource-host.svelte";
import { bindRuntime } from "./runtime.ts";

class Missing extends Data.TaggedError("Missing")<{
	readonly id: string;
}> {}

bindRuntime(Layer.empty);

afterEach(() => {
	cleanup();
});

describe("resource", () => {
	it("exposes loading, success, and tagged-failure as getters", () => {
		const state = resource(Effect.never);
		expect(Object.getOwnPropertyDescriptor(state, "loading")?.get).toBeTypeOf(
			"function",
		);
		expect(Object.getOwnPropertyDescriptor(state, "success")?.get).toBeTypeOf(
			"function",
		);
		expect(Object.getOwnPropertyDescriptor(state, "failure")?.get).toBeTypeOf(
			"function",
		);
	});

	it("stays loading while the program has not completed", () => {
		const state = resource(Effect.never);
		const view = render(ResourceHost, { props: { state } });
		flushSync();
		expect(view.getByTestId("resource-loading").textContent).toBe("true");
		expect(view.getByTestId("resource-success").textContent).toBe("");
		expect(view.getByTestId("resource-failure").textContent).toBe("");
	});

	it("exposes the success value", () => {
		const state = resource(Effect.succeed("ok"));
		const view = render(ResourceHost, { props: { state } });
		flushSync();
		expect(view.getByTestId("resource-loading").textContent).toBe("false");
		expect(view.getByTestId("resource-success").textContent).toBe("ok");
		expect(view.getByTestId("resource-failure").textContent).toBe("");
	});

	it("exposes the tagged failure", () => {
		const state = resource(new Missing({ id: "session-1" }));
		const view = render(ResourceHost, { props: { state } });
		flushSync();
		expect(view.getByTestId("resource-loading").textContent).toBe("false");
		expect(view.getByTestId("resource-success").textContent).toBe("");
		expect(view.getByTestId("resource-failure").textContent).toBe("Missing");
	});
});
