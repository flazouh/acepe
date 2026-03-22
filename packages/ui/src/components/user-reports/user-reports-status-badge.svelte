<script lang="ts">
	import { cn } from '../../lib/utils.js';
	import { STATUS_CONFIG } from './types.js';
	import type { ReportStatus } from './types.js';

	interface Props {
		status: ReportStatus;
		class?: string;
	}

	let { status, class: className }: Props = $props();

	const c = $derived(STATUS_CONFIG[status]);
</script>

<span class={cn('inline-flex items-center gap-0.5 text-[10px] font-mono', c.color, className)}>
	<c.icon size={10} weight="fill" />
	{c.label}
</span>
