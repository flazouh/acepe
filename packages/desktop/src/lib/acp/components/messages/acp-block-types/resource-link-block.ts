import ResourceLinkBlockComponent from "./resource-link-block.svelte";
import type { AcpBlockRenderConfig } from "./types.js";

export const resourceLinkBlockConfig: AcpBlockRenderConfig<"resource_link"> = {
	type: "resource_link",
	component:
		ResourceLinkBlockComponent as unknown as AcpBlockRenderConfig<"resource_link">["component"],
	getProps: (block) => ({
		uri: block.uri,
		name: block.name,
		title: block.title,
		description: block.description,
	}),
};
