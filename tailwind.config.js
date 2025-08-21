/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#F9FAFB",
        green: "#16A34A",
        grayx: "#6B7280",
        bluex: "#3B82F6",
        redx: "#EF4444"
      },
      fontFamily: {
        inter: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"]
      },
      borderRadius: {
        '2xl': '1rem'
      }
    }
  },
  plugins: []
}
