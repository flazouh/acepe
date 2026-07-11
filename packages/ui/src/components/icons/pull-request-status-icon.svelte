<script lang="ts" module>
	export {
		mapGitHubPrStateToLinearStatusIcon,
		mapUppercasePrStateToLinearStatusIcon,
		pullRequestLinearStatusIcons,
		type PullRequestGitHubState,
		type PullRequestLinearStatusIconName,
		type PullRequestLinearStatusKind,
	} from "./pull-request-status-icon.js";
</script>

<script lang="ts">
	import LinearInventoryIcon from "./linear-inventory-icon.svelte";
	import {
		mapGitHubPrStateToLinearStatusIcon,
		mapUppercasePrStateToLinearStatusIcon,
		pullRequestLinearStatusIcons,
		type PullRequestGitHubState,
		type PullRequestLinearStatusIconName,
		type PullRequestLinearStatusKind,
	} from "./pull-request-status-icon.js";

	type PullRequestStatusState = PullRequestGitHubState | "OPEN" | "CLOSED" | "MERGED";

	interface Props {
		state?: PullRequestStatusState;
		kind?: PullRequestLinearStatusKind;
		name?: PullRequestLinearStatusIconName;
		class?: string;
		style?: string;
		role?: string;
		"aria-label"?: string;
		"data-testid"?: string;
	}

	let {
		state,
		kind,
		name,
		class: className = "shrink-0",
		style,
		role,
		"aria-label": ariaLabel,
		"data-testid": dataTestid,
	}: Props = $props();

	const iconName = $derived.by(() => {
		if (name) {
			return name;
		}
		if (kind) {
			return pullRequestLinearStatusIcons[kind];
		}
		if (state === "OPEN" || state === "CLOSED" || state === "MERGED") {
			return mapUppercasePrStateToLinearStatusIcon(state);
		}
		if (state === "open" || state === "closed" || state === "merged") {
			return mapGitHubPrStateToLinearStatusIcon(state);
		}
		return pullRequestLinearStatusIcons.open;
	});
</script>

<LinearInventoryIcon
	name={iconName}
	class={className}
	{style}
	{role}
	aria-label={ariaLabel}
	data-testid={dataTestid}
/>
