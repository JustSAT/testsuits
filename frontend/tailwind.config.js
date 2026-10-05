// `brand` and `slate` read CSS variables defined in src/index.css so a
// deployment theme (VITE_THEME_URL) can restyle the app without rebuilding
// classes. The variables hold "R G B" triplets to keep opacity modifiers.
const cssVar = (name) => `rgb(var(--${name}) / <alpha-value>)`;
const scale = (family, shades) =>
  Object.fromEntries(shades.map((shade) => [shade, cssVar(`${family}-${shade}`)]));

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: scale("brand", [50, 100, 500, 600, 700]),
        slate: scale("slate", [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]),
      },
    },
  },
  plugins: [],
};
