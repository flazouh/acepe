import TextBlockComponent from "./text-block.svelte";
import type { AcpBlockRenderConfig } from "./types.js";

export const textBlockConfig: AcpBlockRenderConfig<"text"> = {
	type: "text",
	component: TextBlockComponent as unknown as AcpBlockRenderConfig<"text">["component"],
	getProps: (block) => ({ text: block.text }),
};
