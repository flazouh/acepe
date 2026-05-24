import type { QueueUpdateInput } from "$lib/acp/store/index.js";

export function resolveQueueUpdateInputs(
	inputs: readonly QueueUpdateInput[] | null | undefined
): readonly QueueUpdateInput[] {
	return inputs ?? [];
}
