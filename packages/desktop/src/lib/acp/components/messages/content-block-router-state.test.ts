import { describe, expect, it } from "bun:test";
import type { Component } from "svelte";

import type { ContentBlock } from "../../schemas/content-block.schema.js";
import type { AcpBlockRenderConfigUnion } from "./acp-block-types/types.js";
import { resolveContentBlockRouteState } from "./content-block-router-state.js";

const fakeComponent = (() => {}) as unknown as Component<Record<string, unknown>>;

const textRenderer = {
	type: "text",
	component: fakeComponent,
	getProps: (block: Extract<ContentBlock, { type: "text" }>) => ({ text: block.text }),
} satisfies AcpBlockRenderConfigUnion;

describe("content-block-router-state", () => {
	it("returns render state with renderer props for valid blocks", () => {
		const state = resolveContentBlockRouteState(
			{ type: "text", text: "hello" },
			() => textRenderer
		);

		expect(state).toEqual({
			type: "render",
			block: { type: "text", text: "hello" },
			renderer: textRenderer,
			props: { text: "hello" },
		});
	});

	it("returns unknown state when no renderer exists for a valid block", () => {
		const state = resolveContentBlockRouteState({ type: "text", text: "hello" }, () => undefined);

		expect(state).toEqual({
			type: "unknown",
			blockType: "text",
		});
	});

	it("returns invalid state for invalid blocks", () => {
		const state = resolveContentBlockRouteState({ type: "text" }, () => textRenderer);

		expect(state.type).toBe("invalid");
		if (state.type === "invalid") {
			expect(state.message).toContain("Invalid content block");
		}
	});
});
