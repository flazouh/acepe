<script lang="ts">
	import { Button } from "../button/index.js";
	import { HugeiconsIcon } from "../icons/index.js";
	import {
		readWindowSpokenReplySynth,
		toggleSpokenReply,
		type SpokenReplySynth,
	} from "./speak-reply.js";
	import { prepareSpokenReplyText } from "./speak-reply-text.js";

	interface Props {
		text: string;
		title?: string;
		speakingTitle?: string;
		size?: "message" | "header";
		class?: string;
		synth?: SpokenReplySynth | null;
	}

	let {
		text,
		title = "Speak reply",
		speakingTitle = "Stop speaking",
		size = "message",
		class: className = "",
		synth,
	}: Props = $props();

	let speaking = $state(false);

	const tooltip = $derived(speaking ? speakingTitle : title);
	const iconName = $derived(speaking ? "stop" : "volume");
	const iconSize = $derived(size === "header" ? null : 13);
	const iconStyle = $derived(
		iconSize === null ? undefined : `width: ${iconSize}px; height: ${iconSize}px;`
	);
	const canSpeak = $derived(prepareSpokenReplyText(text) !== null);

	function resolveSynth(): SpokenReplySynth | null {
		if (synth !== undefined) {
			return synth;
		}
		return readWindowSpokenReplySynth();
	}

	function handleSpeak(): void {
		if (!canSpeak) {
			return;
		}

		const resolved = resolveSynth();
		if (resolved === null) {
			return;
		}

		toggleSpokenReply(
			text,
			resolved,
			{
				onSpeakingChange: (next) => {
					speaking = next;
				},
			},
			speaking
		);
	}
</script>

{#if canSpeak}
	{#if size === "header"}
		<Button
			variant="ghost"
			size="icon-sm"
			data-header-control
			data-speak-reply-trigger
			title={tooltip}
			aria-label={tooltip}
			onclick={handleSpeak}
			class={className}
		>
			{#snippet children()}
				<HugeiconsIcon name={iconName} data-testid="agent-speak-button-icon" />
			{/snippet}
		</Button>
	{:else}
		<button
			type="button"
			class="inline-flex h-6 w-6 shrink-0 items-center justify-center transition-colors hover:bg-accent/60 hover:text-foreground {className}"
			data-speak-reply-trigger
			title={tooltip}
			aria-label={tooltip}
			onclick={handleSpeak}
		>
			<HugeiconsIcon
				name={iconName}
				class="shrink-0"
				style={iconStyle}
				data-testid="agent-speak-button-icon"
			/>
		</button>
	{/if}
{/if}
