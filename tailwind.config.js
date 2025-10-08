/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    // This line tells Tailwind to scan your main React file for classes
    "./src/App.jsx", 
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}