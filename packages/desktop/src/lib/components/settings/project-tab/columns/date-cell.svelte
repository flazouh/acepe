<script lang="ts">
interface Props {
	date: Date;
}

let { date }: Props = $props();

const formatted = $derived.by(() => {
	const now = Date.now();
	const diff = now - date.getTime();
	const minute = 60 * 1000;
	const hour = 60 * minute;
	const day = 24 * hour;

	// Less than 1 minute ago
	if (diff < minute) {
		return "Just now";
	}

	// Less than 1 hour ago
	if (diff < hour) {
		const minutes = Math.floor(diff / minute);
		return `${minutes}m ago`;
	}

	// Less than 24 hours ago
	if (diff < day) {
		const hours = Math.floor(diff / hour);
		return `${hours}h ago`;
	}

	// Less than 7 days ago
	if (diff < 7 * day) {
		const days = Math.floor(diff / day);
		return `${days}d ago`;
	}

	// Otherwise show date
	const options: Intl.DateTimeFormatOptions = {
		month: "short",
		day: "numeric",
	};

	// Add year if not current year
	if (date.getFullYear() !== new Date().getFullYear()) {
		options.year = "numeric";
	}

	return new Intl.DateTimeFormat("en", options).format(date);
});

const fullDate = $derived(
	new Intl.DateTimeFormat("en", {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(date)
);
</script>

<span class="text-muted-foreground whitespace-nowrap" title={fullDate}>{formatted}</span>
