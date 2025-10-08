module.exports = {
  plugins: {
    // FINAL FIX: Using the simplified 'tailwindcss' plugin name to resolve the package subpath error on Vercel.
    // This is the most stable configuration for most modern setups.
    tailwindcss: {}, 
    autoprefixer: {},
  },
};