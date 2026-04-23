<script lang="ts">
	import { DiscordLogo, GithubLogo } from "phosphor-svelte";

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

	const releaseUrl = $derived(
		version ? `https://github.com/flazouh/acepe/releases/tag/v${version}` : null
	);

	const iconButtonClass =
		"flex items-center justify-center size-5 rounded text-muted-foreground/60 hover:text-foreground hover:bg-accent transition-colors";
</script>

<div class="shrink-0 px-2 py-1.5 flex items-center gap-0.5">
	<div class="flex items-center gap-0.5">
		{#if onLinkClick}
			<button
				type="button"
				class={iconButtonClass}
				title="GitHub"
				aria-label="GitHub"
				onclick={() => onLinkClick(githubUrl)}
			>
				<GithubLogo class="size-3.5" weight="fill" />
			</button>
			<button
				type="button"
				class={iconButtonClass}
				title="X"
				aria-label="X"
				onclick={() => onLinkClick(xUrl)}
			>
				<svg viewBox="0 0 24 24" aria-hidden="true" class="size-3 fill-current">
					<path
						d="M18.244 2H21.5l-7.1 8.117L22 22h-5.956l-4.663-6.104L6.04 22H2.78l7.594-8.68L2 2h6.108l4.215 5.56L18.244 2Zm-1.143 18h1.804L5.128 3.895H3.193L17.1 20Z"
					/>
				</svg>
			</button>
			<button
				type="button"
				class={iconButtonClass}
				title="Discord"
				aria-label="Discord"
				onclick={() => onLinkClick(discordUrl)}
			>
				<DiscordLogo class="size-3.5" style="color: #6C75E8" weight="fill" />
			</button>
		{:else}
			<a href={githubUrl} class={iconButtonClass} title="GitHub" aria-label="GitHub">
				<GithubLogo class="size-3.5" weight="fill" />
			</a>
			<a href={xUrl} class={iconButtonClass} title="X" aria-label="X">
				<svg viewBox="0 0 24 24" aria-hidden="true" class="size-3 fill-current">
					<path
						d="M18.244 2H21.5l-7.1 8.117L22 22h-5.956l-4.663-6.104L6.04 22H2.78l7.594-8.68L2 2h6.108l4.215 5.56L18.244 2Zm-1.143 18h1.804L5.128 3.895H3.193L17.1 20Z"
					/>
				</svg>
			</a>
			<a href={discordUrl} class={iconButtonClass} title="Discord" aria-label="Discord">
				<DiscordLogo class="size-3.5" style="color: #6C75E8" weight="fill" />
			</a>
		{/if}
	</div>
	{#if version !== null}
		{#if onLinkClick && releaseUrl}
			<button
				type="button"
				onclick={() => onLinkClick(releaseUrl)}
				class="ml-auto text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
				title={`Open release notes for v${version}`}
			>
				v{version}
			</button>
		{:else if releaseUrl}
			<a
				href={releaseUrl}
				class="ml-auto text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
				title={`Open release notes for v${version}`}
			>
				v{version}
			</a>
		{/if}
	{/if}
</div>
