<script lang="ts">
interface Props {
	class?: string;
}

let { class: className = "h-6 w-6" }: Props = $props();
</script>

<!--
	Acepe mark — the seven-bar speed glyph from the app icon, with the light shell
	stripped away. Bars render light (cream) on the dark page; the scattered dots
	are the icon's speckled "space" texture, inverted for light-on-dark. Baked with
	a fixed seed so the constellation is stable across renders.
-->
<svg
	class={className}
	viewBox="0 0 120 120"
	fill="none"
	xmlns="http://www.w3.org/2000/svg"
	aria-hidden="true"
>
	<g>
		<rect x="14.25" y="18.0" width="2" height="84.0" rx="0.6" fill="#f8f5ee"/>
		<rect x="21.25" y="18.0" width="3" height="84.0" rx="0.6" fill="#f8f5ee"/>
		<rect x="29.25" y="18.0" width="4.5" height="84.0" rx="0.6" fill="#f8f5ee"/>
		<rect x="38.75" y="18.0" width="8" height="84.0" rx="0.6" fill="#f8f5ee"/>
		<rect x="51.75" y="18.0" width="11" height="84.0" rx="0.6" fill="#f8f5ee"/>
		<rect x="67.75" y="18.0" width="15" height="84.0" rx="0.6" fill="#f8f5ee"/>
		<rect x="87.75" y="18.0" width="18" height="84.0" rx="0.6" fill="#f8f5ee"/>
		<circle cx="15.39" cy="20.86" r="0.37" fill="#121212" opacity="0.43"/>
		<circle cx="15.49" cy="74.56" r="0.72" fill="#121212" opacity="0.35"/>
		<circle cx="22.59" cy="21.26" r="0.34" fill="#121212" opacity="0.6"/>
		<circle cx="21.8" cy="35.18" r="0.58" fill="#121212" opacity="0.63"/>
		<circle cx="22.19" cy="67.36" r="0.67" fill="#121212" opacity="0.3"/>
		<circle cx="32.57" cy="76.33" r="0.41" fill="#121212" opacity="0.39"/>
		<circle cx="33.1" cy="46.54" r="0.27" fill="#121212" opacity="0.36"/>
		<circle cx="32.72" cy="68.55" r="0.67" fill="#121212" opacity="0.74"/>
		<circle cx="31.63" cy="98.98" r="0.43" fill="#121212" opacity="0.63"/>
		<circle cx="32.65" cy="69.77" r="0.7" fill="#121212" opacity="0.65"/>
		<circle cx="44.18" cy="22.58" r="0.35" fill="#121212" opacity="0.47"/>
		<circle cx="39.81" cy="37.98" r="0.28" fill="#121212" opacity="0.47"/>
		<circle cx="43.7" cy="48.86" r="0.43" fill="#121212" opacity="0.43"/>
		<circle cx="41.12" cy="95.98" r="0.58" fill="#121212" opacity="0.67"/>
		<circle cx="40.45" cy="78.88" r="0.31" fill="#121212" opacity="0.53"/>
		<circle cx="46.18" cy="71.54" r="0.53" fill="#121212" opacity="0.71"/>
		<circle cx="45.15" cy="82.74" r="0.35" fill="#121212" opacity="0.32"/>
		<circle cx="41.46" cy="40.86" r="0.34" fill="#121212" opacity="0.87"/>
		<circle cx="45.38" cy="44.73" r="0.59" fill="#121212" opacity="0.54"/>
		<circle cx="61.4" cy="56.61" r="0.37" fill="#121212" opacity="0.45"/>
		<circle cx="57.86" cy="40.45" r="0.55" fill="#121212" opacity="0.84"/>
		<circle cx="56.24" cy="36.87" r="0.78" fill="#121212" opacity="0.61"/>
		<circle cx="53.16" cy="22.68" r="0.28" fill="#121212" opacity="0.68"/>
		<circle cx="60.17" cy="53.59" r="0.26" fill="#121212" opacity="0.53"/>
		<circle cx="62.21" cy="62.4" r="0.76" fill="#121212" opacity="0.82"/>
		<circle cx="52.36" cy="78.19" r="0.6" fill="#121212" opacity="0.62"/>
		<circle cx="54.92" cy="71.62" r="0.28" fill="#121212" opacity="0.56"/>
		<circle cx="56.79" cy="97.39" r="0.71" fill="#121212" opacity="0.46"/>
		<circle cx="57.26" cy="33.52" r="0.73" fill="#121212" opacity="0.82"/>
		<circle cx="55.23" cy="71.45" r="0.56" fill="#121212" opacity="0.39"/>
		<circle cx="59.88" cy="63.24" r="0.66" fill="#121212" opacity="0.62"/>
		<circle cx="68.26" cy="45.51" r="0.23" fill="#121212" opacity="0.86"/>
		<circle cx="80.55" cy="87.33" r="0.39" fill="#121212" opacity="0.33"/>
		<circle cx="80.54" cy="96.83" r="0.27" fill="#121212" opacity="0.59"/>
		<circle cx="69.22" cy="81.47" r="0.65" fill="#121212" opacity="0.38"/>
		<circle cx="74.9" cy="64.1" r="0.37" fill="#121212" opacity="0.82"/>
		<circle cx="74.17" cy="36.25" r="0.52" fill="#121212" opacity="0.74"/>
		<circle cx="71.07" cy="44.49" r="0.78" fill="#121212" opacity="0.69"/>
		<circle cx="74.38" cy="61.45" r="0.29" fill="#121212" opacity="0.43"/>
		<circle cx="72.98" cy="67.28" r="0.35" fill="#121212" opacity="0.43"/>
		<circle cx="69.24" cy="70.8" r="0.35" fill="#121212" opacity="0.84"/>
		<circle cx="80.28" cy="24.64" r="0.35" fill="#121212" opacity="0.7"/>
		<circle cx="71.25" cy="29.7" r="0.74" fill="#121212" opacity="0.64"/>
		<circle cx="74.87" cy="83.45" r="0.67" fill="#121212" opacity="0.41"/>
		<circle cx="69.61" cy="54.32" r="0.46" fill="#121212" opacity="0.58"/>
		<circle cx="78.46" cy="74.29" r="0.77" fill="#121212" opacity="0.36"/>
		<circle cx="73.89" cy="46.76" r="0.7" fill="#121212" opacity="0.45"/>
		<circle cx="91.48" cy="55.77" r="0.46" fill="#121212" opacity="0.47"/>
		<circle cx="92.5" cy="94.88" r="0.47" fill="#121212" opacity="0.82"/>
		<circle cx="97.61" cy="22.97" r="0.78" fill="#121212" opacity="0.8"/>
		<circle cx="104.72" cy="95.13" r="0.7" fill="#121212" opacity="0.4"/>
		<circle cx="96.51" cy="36.41" r="0.44" fill="#121212" opacity="0.34"/>
		<circle cx="94.69" cy="99.99" r="0.37" fill="#121212" opacity="0.77"/>
		<circle cx="95.99" cy="53.66" r="0.76" fill="#121212" opacity="0.9"/>
		<circle cx="97.7" cy="78.0" r="0.31" fill="#121212" opacity="0.48"/>
		<circle cx="104.72" cy="66.52" r="0.52" fill="#121212" opacity="0.75"/>
		<circle cx="89.22" cy="66.94" r="0.5" fill="#121212" opacity="0.81"/>
		<circle cx="90.93" cy="97.97" r="0.26" fill="#121212" opacity="0.41"/>
		<circle cx="98.37" cy="74.44" r="0.35" fill="#121212" opacity="0.37"/>
		<circle cx="103.38" cy="39.09" r="0.55" fill="#121212" opacity="0.67"/>
		<circle cx="95.38" cy="66.89" r="0.51" fill="#121212" opacity="0.86"/>
		<circle cx="91.72" cy="77.81" r="0.35" fill="#121212" opacity="0.54"/>
		<circle cx="99.67" cy="43.52" r="0.4" fill="#121212" opacity="0.75"/>
		<circle cx="89.48" cy="56.56" r="0.78" fill="#121212" opacity="0.9"/>
		<circle cx="89.5" cy="36.36" r="0.37" fill="#121212" opacity="0.86"/>
		<circle cx="103.22" cy="91.25" r="0.43" fill="#121212" opacity="0.39"/>
		<circle cx="102.42" cy="76.77" r="0.56" fill="#121212" opacity="0.89"/>
		<circle cx="43.76" cy="64.37" r="0.95" fill="#121212" opacity="0.95"/>
		<circle cx="45.38" cy="30.74" r="0.95" fill="#121212" opacity="0.95"/>
		<circle cx="45.09" cy="79.39" r="0.95" fill="#121212" opacity="0.95"/>
		<circle cx="55.2" cy="68.39" r="0.95" fill="#121212" opacity="0.95"/>
		<circle cx="71.4" cy="70.74" r="0.95" fill="#121212" opacity="0.95"/>
		<circle cx="75.32" cy="40.09" r="0.95" fill="#121212" opacity="0.95"/>
		<circle cx="40.3" cy="53.89" r="0.95" fill="#121212" opacity="0.95"/>
		<circle cx="69.32" cy="46.68" r="0.95" fill="#121212" opacity="0.95"/>
	</g>
</svg>
