import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

const isWatch = process.argv.includes('--watch');

// Build code.ts (sandbox)
const codeBuild = {
  entryPoints: ['src/code.ts'],
  bundle: true,
  outfile: 'dist/code.js',
  target: 'es2017',
  format: 'iife',
};

// Build UI: inline everything into a single HTML file
async function buildUI() {
  const uiSource = fs.readFileSync('src/ui.html', 'utf8');

  // Build TS for UI
  const result = await esbuild.build({
    entryPoints: ['src/ui.ts'],
    bundle: true,
    write: false,
    target: 'es2017',
    format: 'iife',
  });
  const jsCode = result.outputFiles[0].text;

  // Read CSS
  const cssCode = fs.readFileSync('src/ui.css', 'utf8');

  // Inject into HTML
  const html = uiSource
    .replace('/* __INJECT_CSS__ */', cssCode)
    .replace('/* __INJECT_JS__ */', jsCode);

  fs.mkdirSync('dist', { recursive: true });
  fs.writeFileSync('dist/ui.html', html);
}

async function build() {
  await esbuild.build(codeBuild);
  await buildUI();
  console.log('Build complete.');
}

if (isWatch) {
  const ctx = await esbuild.context(codeBuild);
  await ctx.watch();
  // Simple polling for UI changes
  console.log('Watching for changes...');
  let lastBuild = 0;
  setInterval(async () => {
    const files = ['src/ui.html', 'src/ui.ts', 'src/ui.css'];
    const maxMtime = Math.max(...files.map(f => {
      try { return fs.statSync(f).mtimeMs; } catch { return 0; }
    }));
    if (maxMtime > lastBuild) {
      lastBuild = Date.now();
      try {
        await buildUI();
        console.log('UI rebuilt.');
      } catch (e) {
        console.error('UI build error:', e);
      }
    }
  }, 500);
} else {
  await build();
}
