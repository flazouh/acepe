<script lang="ts" module>
	export {
		mapGitHubPrStateToStatusIcon,
		mapUppercasePrStateToStatusIcon,
		pullRequestStatusIcons,
		type PullRequestGitHubState,
		type PullRequestStatusIconName,
		type PullRequestStatusKind,
	} from "./pull-request-status-icon.js";
</script>

<script lang="ts">
	import HugeiconsIcon from "./hugeicons-icon.svelte";
	import {
		mapGitHubPrStateToStatusIcon,
		mapUppercasePrStateToStatusIcon,
		pullRequestStatusIcons,
		type PullRequestGitHubState,
		type PullRequestStatusIconName,
		type PullRequestStatusKind,
	} from "./pull-request-status-icon.js";

	type PullRequestStatusState = PullRequestGitHubState | "OPEN" | "CLOSED" | "MERGED";

	interface Props {
		state?: PullRequestStatusState;
	kind?: PullRequestStatusKind;
	name?: PullRequestStatusIconName;
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
			return pullRequestStatusIcons[kind];
		}
		if (state === "OPEN" || state === "CLOSED" || state === "MERGED") {
			return mapUppercasePrStateToStatusIcon(state);
		}
		if (state === "open" || state === "closed" || state === "merged") {
			return mapGitHubPrStateToStatusIcon(state);
		}
		return pullRequestStatusIcons.open;
	});
</script>

<HugeiconsIcon
	name={iconName}
	class={className}
	{style}
	{role}
	aria-label={ariaLabel}
	data-testid={dataTestid}
/>
