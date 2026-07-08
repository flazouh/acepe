<script lang="ts">
	interface Props {
		size?: "sm" | "md" | "lg";
		class?: string;
		style?: string;
		"data-testid"?: string;
	}

	let { size = "md", class: className, style, "data-testid": testId }: Props = $props();

	const sizeClasses = {
		sm: "size-3",
		md: "size-3.5",
		lg: "size-4",
	};
</script>

<span
	class="build-icon-root inline-flex shrink-0 items-center justify-center {sizeClasses[size]} {className ? className : ''}"
	style={style}
	data-testid={testId}
	aria-hidden="true"
>
	<span class="build-icon-tool">
		<span class="build-icon-tip"></span>
		<span class="build-icon-shaft"></span>
		<span class="build-icon-handle"></span>
	</span>
</span>

<style>
	.build-icon-root {
		color: var(--build-icon, var(--color-success, var(--success)));
	}

	/* Mode bar and similar: parent sets color; keep inheriting that path. */
	.build-icon-root.text-current {
		color: currentColor;
	}

	.build-icon-tool {
		position: relative;
		display: block;
		width: 100%;
		height: 100%;
		transform: rotate(-45deg);
	}

	.build-icon-tip,
	.build-icon-shaft,
	.build-icon-handle {
		position: absolute;
		left: 50%;
		background: currentColor;
		transform: translateX(-50%);
	}

	.build-icon-tip {
		top: 3%;
		width: 32%;
		height: 16%;
		border-radius: 1px 1px 2px 2px;
		clip-path: polygon(24% 0, 76% 0, 100% 100%, 0 100%);
	}

	.build-icon-shaft {
		top: 18%;
		width: 18%;
		height: 44%;
		border-radius: 999px;
	}

	.build-icon-handle {
		top: 56%;
		width: 42%;
		height: 36%;
		border-radius: 2px 2px 4px 4px;
	}
</style>
