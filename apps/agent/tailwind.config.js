/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  "#E8F7F6",
          100: "#C5EBE8",
          200: "#9DDDD8",
          300: "#6ECFC8",
          400: "#48C4BB",
          500: "#2AADA0",   // Primary teal
          600: "#239590",
          700: "#1B7A75",
          800: "#135F5B",
          900: "#0A4441",
        },
        gold: {
          50:  "#FFFBEB",
          100: "#FEF3C7",
          200: "#FDE68A",
          300: "#FCD34D",
          400: "#FBBF24",
          500: "#F9C22B",   // Kirimba yellow
          600: "#D97706",
          700: "#B45309",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      borderRadius: {
        "2xl": "1rem",
        "3xl": "1.5rem",
      },
      boxShadow: {
        card: "0 2px 12px rgba(42, 173, 160, 0.10)",
        "card-lg": "0 4px 24px rgba(42, 173, 160, 0.15)",
      },
    },
  },
  plugins: [],
};
