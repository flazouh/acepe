<script lang="ts">
	import { ProjectLetterBadge } from "@acepe/ui";

	interface Props {
		projectName: string;
		projectColor: string;
		projectIconSrc?: string | null;
	}

	let { projectName, projectColor, projectIconSrc = null }: Props = $props();
</script>

<div class="flex items-center gap-1.5 px-1 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground/75">
	<ProjectLetterBadge name={projectName} color={projectColor} iconSrc={projectIconSrc} size={14} />
	<span class="truncate">{projectName}</span>
</div>
