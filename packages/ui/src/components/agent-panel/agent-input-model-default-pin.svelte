<script lang="ts">
	import { cn } from "../../lib/utils.js";
	import DefaultAgentPinIcon from "./default-agent-pin-icon.svelte";

	interface Props {
		isDefault: boolean;
		label: string;
		onToggle: () => void;
	}

	let { isDefault, label, onToggle }: Props = $props();
</script>

<button
	type="button"
	aria-label={isDefault ? `Clear ${label} as default model` : `Set ${label} as default model`}
	aria-pressed={isDefault}
	onclick={(event) => {
		event.stopPropagation();
		onToggle();
	}}
	class={cn(
		"group/pin grid h-4 w-4 shrink-0 place-items-center transition-colors",
		isDefault
			? "text-foreground"
			: "text-muted-foreground hover:text-foreground focus-visible:text-foreground"
	)}
>
	<DefaultAgentPinIcon active={isDefault} />
</button>
