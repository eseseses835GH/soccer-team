// Test helper: every new browser context starts with the first-visit "פעם ראשונה בכוחות?" sheet
// already seen, so existing flows aren't covered by it. Pass `{ welcome: true }` to newContext to
// get a truly fresh visitor. Same for the keeper-order sheet that opens by itself on the first
// teams screen: `{ gkIntro: true }` keeps it.
export function quietWelcome(browser) {
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (opts = {}) => {
    const { welcome, gkIntro, ...rest } = opts;
    const ctx = await newContext(rest);
    if (!welcome)
      await ctx.addInitScript(() => {
        try {
          if (!localStorage.getItem('kochot:welcomed')) localStorage.setItem('kochot:welcomed', 'true');
        } catch {
          /* ignore */
        }
      });
    if (!gkIntro)
      await ctx.addInitScript(() => {
        try {
          if (!localStorage.getItem('kochot:gk-order-seen')) localStorage.setItem('kochot:gk-order-seen', 'true');
        } catch {
          /* ignore */
        }
      });
    return ctx;
  };
  browser.newPage = async (opts = {}) => (await browser.newContext(opts)).newPage();
  return browser;
}
