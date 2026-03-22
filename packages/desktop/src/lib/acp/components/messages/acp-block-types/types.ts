import type { Component } from "svelte";

import type { ContentBlock } from "../../../schemas/content-block.schema.js";

/**
 * Component type for block renderer registry.
 * Uses Record<string, unknown> to accept any Svelte component; each config
 * supplies correct props via getProps at runtime.
 */
export type BlockRendererComponent = Component<Record<string, unknown>>;

/** Config for rendering a single ACP content block type. */
export type AcpBlockRenderConfig<T extends ContentBlock["type"] = ContentBlock["type"]> = {
	type: T;
	component: BlockRendererComponent;
	/** Props to pass; (block) => Record (block is narrowed to type T) */
	getProps: (block: Extract<ContentBlock, { type: T }>) => Record<string, unknown>;
};

/** Union of all block render configs for registry typing. */
export type AcpBlockRenderConfigUnion =
	| AcpBlockRenderConfig<"text">
	| AcpBlockRenderConfig<"image">
	| AcpBlockRenderConfig<"audio">
	| AcpBlockRenderConfig<"resource">
	| AcpBlockRenderConfig<"resource_link">;
