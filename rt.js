
(() => {
  try {
    const leanbackKey = 'yt.leanback.default::recurring_actions';
    const leanbackStr = localStorage.getItem(leanbackKey);
    
    if (leanbackStr) {
      const actions = JSON.parse(leanbackStr);
      // Set the "last fired" time to 7 days in the future to prevent the prompt
      const futureDate = Date.now() + (7 * 24 * 60 * 60 * 1000); 

      const targetKeys = [
        "startup-screen-account-selector-with-guest",
        "whos_watching_fullscreen_zero_accounts",
        "startup-screen-signed-out-welcome-back"
      ];

      let modified = false;
      if (actions?.data?.data) {
        targetKeys.forEach(key => {
          if (actions.data.data[key]) {
            actions.data.data[key].lastFired = futureDate;
            modified = true;
          }
        });
      }

      if (modified) {
        localStorage.setItem(leanbackKey, JSON.stringify(actions));
        console.log("Who is watching prompts disabled");
      }
    }
  } catch (e) {
    console.error("Error modifying recurring actions:", e);
  }
  
  const origParse = JSON.parse;

  JSON.parse = function (...args) {
    const r = origParse.apply(this, args);

    // Video / player ads
    if (r?.adPlacements) r.adPlacements = [];
    if (r?.adSlots) r.adSlots = [];
    if (r?.playerAds) r.playerAds = false;
    console.log("Add removed");
    // Endscreen cards
    if (r?.endscreen) r.endscreen = null;

    // Shorts / reel ads
    if (Array.isArray(r?.entries)) {
      r.entries = r.entries.filter(
        e => !e?.command?.reelWatchEndpoint?.adClientParams?.isAd
      );
    }

    // Home / browse masthead ads (TV UI)
    const shelves =
      r?.contents?.tvBrowseRenderer?.content
        ?.tvSurfaceContentRenderer?.content
        ?.sectionListRenderer?.contents;

    if (Array.isArray(shelves)) {
      // Remove ad shelves
      for (let i = shelves.length - 1; i >= 0; i--) {
        if (shelves[i]?.adSlotRenderer) {
          shelves.splice(i, 1);
        }
      }

      // Remove ads inside shelves
      for (const shelf of shelves) {
        const items =
          shelf?.shelfRenderer?.content
            ?.horizontalListRenderer?.items;

        if (Array.isArray(items)) {
          shelf.shelfRenderer.content.horizontalListRenderer.items =
            items.filter(item => !item?.adSlotRenderer);
        }
      }
    }

    return r;
  };

  // Patch global references (YT TV uses isolated contexts)
  window.JSON.parse = JSON.parse;

  if (window._yttv) {
    for (const k in window._yttv) {
      const ctx = window._yttv[k];
      if (ctx?.JSON?.parse) {
        ctx.JSON.parse = JSON.parse;
      }
    }
  }
})();
