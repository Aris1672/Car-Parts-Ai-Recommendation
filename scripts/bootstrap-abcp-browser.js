const browser = require('../lib/logistics/abcpBrowser');
(async () => {
  const result = await browser.bootstrap();
  console.log(JSON.stringify({ ...result, profileDir: browser.profileDir(), liveActionsEnabled: browser.liveActionsEnabled() }, null, 2));
  if (!result.authenticated) process.exitCode = 2;
})().catch(err => { console.error(err.message); process.exit(1); });
