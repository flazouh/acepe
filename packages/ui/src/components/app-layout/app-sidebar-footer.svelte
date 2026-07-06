<script lang="ts">
	import { Button } from "../button/index.js";
	import { DiscordIcon, RoundedIcon, XLogoIcon } from "../icons/index.js";

	interface Props {
		githubUrl: string;
		xUrl: string;
		discordUrl: string;
		/** App version string, or `null` to omit the release-notes link. */
		version: string | null;
		/** Optional click handler; when provided, anchors become buttons invoking it. */
		onLinkClick?: (url: string) => void;
	}

	let { githubUrl, xUrl, discordUrl, version, onLinkClick }: Props = $props();

	const chromeIconButton = { variant: "ghost" as const, size: "icon-2xs" as const };

	const releaseUrl = $derived(
		version ? `https://github.com/flazouh/acepe/releases/tag/v${version}` : null
	);
</script>

<div class="shrink-0 px-2 py-1.5 flex items-center gap-0.5">
	<div class="flex items-center gap-0.5">
		{#if onLinkClick}
			<Button
				{...chromeIconButton}
				title="GitHub"
				aria-label="GitHub"
				onclick={() => onLinkClick(githubUrl)}
			>
				{#snippet children()}
					<RoundedIcon name="github" />
				{/snippet}
			</Button>
			<Button
				{...chromeIconButton}
				title="X"
				aria-label="X"
				onclick={() => onLinkClick(xUrl)}
			>
				{#snippet children()}
					<XLogoIcon />
				{/snippet}
			</Button>
			<Button
				{...chromeIconButton}
				title="Discord"
				aria-label="Discord"
				onclick={() => onLinkClick(discordUrl)}
			>
				{#snippet children()}
					<DiscordIcon weight="fill" />
				{/snippet}
			</Button>
		{:else}
			<Button {...chromeIconButton} href={githubUrl} title="GitHub" aria-label="GitHub">
				{#snippet children()}
					<RoundedIcon name="github" />
				{/snippet}
			</Button>
			<Button {...chromeIconButton} href={xUrl} title="X" aria-label="X">
				{#snippet children()}
					<XLogoIcon />
				{/snippet}
			</Button>
			<Button {...chromeIconButton} href={discordUrl} title="Discord" aria-label="Discord">
				{#snippet children()}
					<DiscordIcon weight="fill" />
				{/snippet}
			</Button>
		{/if}
	</div>
	{#if version !== null}
		{#if onLinkClick && releaseUrl}
			<Button
				variant="ghost"
				class="ml-auto h-auto min-h-0 gap-0 p-0 text-[10px] font-normal text-muted-foreground/50 hover:bg-transparent hover:text-muted-foreground"
				title={`Open release notes for v${version}`}
				onclick={() => onLinkClick(releaseUrl)}
			>
				{#snippet children()}
					v{version}
				{/snippet}
			</Button>
		{:else if releaseUrl}
			<Button
				variant="ghost"
				href={releaseUrl}
				class="ml-auto h-auto min-h-0 gap-0 p-0 text-[10px] font-normal text-muted-foreground/50 hover:bg-transparent hover:text-muted-foreground"
				title={`Open release notes for v${version}`}
			>
				{#snippet children()}
					v{version}
				{/snippet}
			</Button>
		{/if}
	{/if}
</div>
