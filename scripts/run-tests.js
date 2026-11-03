/**
 * npm test: runs every scripts/test-*.js that needs no arguments.
 * test-laximo-parsers.js needs a folder of saved pages and runs on its own:
 *   node scripts/test-laximo-parsers.js <folder>
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const skip = new Set(['test-laximo-parsers.js']);
const files = fs.readdirSync(__dirname).filter(f => /^test-.*\.js$/.test(f) && !skip.has(f)).sort();
let failed = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit' });
  } catch {
    failed++;
    console.error(`FAILED: ${f}`);
  }
}
console.log(`\n${files.length - failed}/${files.length} test files passed`);
process.exit(failed ? 1 : 0);
