/** @type {import('tailwindcss').Config} */
export default {
	darkMode: ["class"],
	content: ["./src/**/*.{html,js,svelte,ts}"],
	theme: {
		extend: {
			colors: {
				border: "var(--border)",
				input: "var(--input)",
				ring: "var(--ring)",
				background: "var(--background)",
				foreground: "var(--foreground)",
				primary: {
					DEFAULT: "var(--primary)",
					foreground: "var(--primary-foreground)",
				},
				secondary: {
					DEFAULT: "var(--secondary)",
					foreground: "var(--secondary-foreground)",
				},
				destructive: {
					DEFAULT: "var(--destructive)",
					foreground: "var(--destructive-foreground)",
				},
				muted: {
					DEFAULT: "var(--muted)",
					foreground: "var(--muted-foreground)",
				},
				accent: {
					DEFAULT: "var(--accent)",
					foreground: "var(--accent-foreground)",
				},
				popover: {
					DEFAULT: "var(--popover)",
					foreground: "var(--popover-foreground)",
				},
				card: {
					DEFAULT: "var(--card)",
					foreground: "var(--card-foreground)",
				},
				diff: {
					added: "var(--success)",
					removed: "#FF5D5A",
				},
				success: "var(--success)",
				warning: "#FF8D20",
			},
			borderRadius: {
				lg: "var(--radius)",
				md: "calc(var(--radius) - 2px)",
				sm: "calc(var(--radius) - 4px)",
			},
			transitionDuration: {
				stagger: "var(--duration-stagger)", // per-item stagger offset
				micro: "var(--duration-micro)", // tooltip/path delay, shake segment, large stagger
				quick: "var(--duration-quick)", // modal/dropdown close, text swap, tooltip appear
				fast: "var(--duration-fast)", // icon swap, dropdown/modal open, tabs sliding, page slide
				medium: "var(--duration-medium)", // panel close, toast close
				slow: "var(--duration-slow)", // panel open, skeleton content reveal, input clear
				"very-slow": "var(--duration-very-slow)", // emphasis moments, badge appear, text reveal, success check
			},
			transitionTimingFunction: {
				"smooth-out": "var(--ease-smooth-out)", // modal/dropdown/panel open + close, page slide, resize, position change
				"in-out": "var(--ease-in-out)", // icon swap, text swap, text reveal, skeleton reveal
				out: "var(--ease-out)", // tooltip open / close
				linear: "var(--ease-linear)", // shimmer, skeleton pulse, spinner
				bounce: "var(--ease-bounce)", // badge pop open
				"bounce-strong": "var(--ease-bounce-strong)", // bouncy hover-out (avatar return)
			},
		},
	},
};
