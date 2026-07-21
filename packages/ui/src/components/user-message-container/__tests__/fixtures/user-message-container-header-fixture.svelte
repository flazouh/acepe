<script lang="ts">
	import UserMessageContainer from "../../user-message-container.svelte";

	interface Props {
		class?: string;
		headerLabel: string;
		bodyText: string;
	}

	let { class: className = "", headerLabel, bodyText }: Props = $props();
</script>

<UserMessageContainer class={className} dataTestid="user-message-surface">
	{#snippet header()}
		<span data-testid="user-message-header-label">{headerLabel}</span>
	{/snippet}
	{bodyText}
</UserMessageContainer>
