// Test helper: every new browser context starts with the first-visit "פעם ראשונה בכוחות?" sheet
// already seen, so existing flows aren't covered by it. Pass `{ welcome: true }` to newContext to
// get a truly fresh visitor. Same for the keeper-order sheet that opens by itself on the first
// teams screen: `{ gkIntro: true }` keeps it. And the one-time home prompts (v36: "סיור קצר?" and
// "עצבו את הקלף שלכם"): `{ nudges: true }` keeps them. The after-game review card (v37, "איך שיחקו
// הערב?") reads as put off for every evening unless `{ reviews: true }`.
export function quietWelcome(browser) {
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (opts = {}) => {
    const { welcome, gkIntro, nudges, reviews, ...rest } = opts;
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
    if (!nudges)
      await ctx.addInitScript(() => {
        try {
          for (const k of ['kochot:tour:org', 'kochot:tour:player']) if (!localStorage.getItem(k)) localStorage.setItem(k, 'true');
          // The card invite is per group: every group reads as answered.
          const get = Storage.prototype.getItem;
          Storage.prototype.getItem = function (k) {
            const v = get.call(this, k);
            return v === null && typeof k === 'string' && k.startsWith('kochot:card-invite:') ? 'true' : v;
          };
        } catch {
          /* ignore */
        }
      });
    if (!reviews)
      await ctx.addInitScript(() => {
        try {
          const get = Storage.prototype.getItem;
          Storage.prototype.getItem = function (k) {
            const v = get.call(this, k);
            return v === null && typeof k === 'string' && k.startsWith('kochot:review:') ? '"later"' : v;
          };
        } catch {
          /* ignore */
        }
      });
    return ctx;
  };
  browser.newPage = async (opts = {}) => (await browser.newContext(opts)).newPage();
  return browser;
}
