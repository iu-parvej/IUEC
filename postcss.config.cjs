module.exports = {
  plugins: {
    // FIX: Using the officially recommended PostCSS plugin name to resolve the Vercel build error.
    'tailwindcss/postcss': {}, 
    autoprefixer: {},
  },
};