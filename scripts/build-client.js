// Builds client/dist: Tailwind CSS (CLI, purged + minified), self-hosted fonts, GSAP, ScrollTrigger, Chart.js.
// No CDN at runtime -> strict CSP, works offline on campus Wi-Fi.
const { execFileSync } = require('child_process');
const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..'), dist = path.join(root, 'client', 'dist'), v = path.join(dist, 'vendor');
fs.rmSync(dist, { recursive: true, force: true }); fs.mkdirSync(path.join(v, 'fonts'), { recursive: true });
const cp = (from, to) => fs.copyFileSync(path.join(root, 'node_modules', from), path.join(v, to));
cp('gsap/dist/gsap.min.js', 'gsap.min.js'); cp('gsap/dist/ScrollTrigger.min.js', 'ScrollTrigger.min.js'); cp('chart.js/dist/chart.umd.js', 'chart.umd.js');
let faces = '';
for (const w of [400, 500, 600, 700]) for (const sub of ['arabic', 'latin']) {
  const f = `ibm-plex-sans-arabic-${sub}-${w}-normal.woff2`;
  cp(`@fontsource/ibm-plex-sans-arabic/files/${f}`, `fonts/${f}`);
  const range = sub === 'arabic' ? 'U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0898-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC' : 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
  faces += `@font-face{font-family:"IBM Plex Sans Arabic";font-style:normal;font-display:swap;font-weight:${w};src:url(/dist/vendor/fonts/${f}) format("woff2");unicode-range:${range}}\n`;
}
fs.writeFileSync(path.join(dist, 'fonts.css'), faces);
execFileSync(path.join(root, 'node_modules', '.bin', 'tailwindcss'), ['-c', 'tailwind.config.js', '-i', 'client/src/styles.css', '-o', 'client/dist/app.css', '--minify'], { cwd: root, stdio: 'inherit' });
console.log('client built ->', path.relative(root, dist));
