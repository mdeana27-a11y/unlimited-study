/** Design tokens live as CSS variables (client/src/styles.css) so light/dark/accent switching costs zero JS. */
module.exports = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./client/public/index.html', './client/js/**/*.js'],
  theme: {
    extend: {
      colors: {
        indigo: { 900: '#1E1B4B', 800: '#312E81' },
        slate: { 950: '#0B1020', 900: '#111827', 800: '#1F2937' },
        cyan: { neon: '#22D3EE' }, violet: { electric: '#8B5CF6' },
        mint: '#34D399', amber: { warn: '#FBBF24' }, rose: { err: '#FB7185' },
        ink: 'rgb(var(--ink) / <alpha-value>)', mute: 'rgb(var(--mute) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)', accent: 'rgb(var(--accent) / <alpha-value>)',
      },
      fontFamily: { sans: ['"IBM Plex Sans Arabic"', 'system-ui', 'sans-serif'] },
      borderRadius: { xl2: '1.25rem' },
    },
  },
  plugins: [],
};
