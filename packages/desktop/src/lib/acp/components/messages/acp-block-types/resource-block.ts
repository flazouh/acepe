import ResourceBlockComponent from "./resource-block.svelte";
import type { AcpBlockRenderConfig } from "./types.js";

export const resourceBlockConfig: AcpBlockRenderConfig<"resource"> = {
	type: "resource",
	component: ResourceBlockComponent as unknown as AcpBlockRenderConfig<"resource">["component"],
	getProps: (block) => ({ resource: block.resource }),
};
