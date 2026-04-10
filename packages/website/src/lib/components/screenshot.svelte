<script lang="ts">
interface ScreenshotProps {
	src: string;
	alt: string;
}

let { src, alt }: ScreenshotProps = $props();
</script>

<img {src} {alt} class="h-full w-full object-contain" />
