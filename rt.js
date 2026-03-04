
(() => {
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


// for watching menu
(() => {
  const KEY = "yt.leanback.default::recurring_actions";
  const raw = localStorage.getItem(KEY);
  if (!raw) throw new Error(`Missing localStorage key: ${KEY}`);

  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new Error(`Could not parse ${KEY}`);
  }

  const data = obj?.data?.data;
  if (!data) throw new Error(`Unexpected ${KEY} structure`);

  const now = Date.now();
  const days = 7; // project sets ~7 days ahead
  const future = now + days * 24 * 60 * 60 * 1000;

  const setLastFired = (k) => {
    if (data[k] && typeof data[k] === "object") data[k].lastFired = future;
  };

  setLastFired("startup-screen-account-selector-with-guest");
  setLastFired("whos_watching_fullscreen_zero_accounts");
  setLastFired("startup-screen-signed-out-welcome-back");

  localStorage.setItem(KEY, JSON.stringify(obj));
  console.log("Done: pushed Who’s watching recurring actions out by", days, "days. Reload the page.");
})();










// for speed 
(() => {
  // === Tiny "TizenTube-like" config (localStorage) ===
  const CONFIG_KEY = "ytaf-configuration";
  const defaultConfig = { videoSpeed: 1, speedSettingsIncrement: 0.25 };
  const readConfigObj = () => {
    try {
      return JSON.parse(localStorage.getItem(CONFIG_KEY) || "null") || { ...defaultConfig };
    } catch {
      return { ...defaultConfig };
    }
  };
  const writeConfigObj = (obj) => localStorage.setItem(CONFIG_KEY, JSON.stringify(obj));
  const configRead = (key) => {
    const cfg = readConfigObj();
    if (cfg[key] === undefined) {
      cfg[key] = defaultConfig[key];
      writeConfigObj(cfg);
    }
    return cfg[key];
  };
  const configWrite = (key, value) => {
    const cfg = readConfigObj();
    cfg[key] = value;
    writeConfigObj(cfg);
  };

  // === YouTube TV "resolveCommand" finder (matches your project) ===
  const getResolveCommand = () => {
    const yttv = window._yttv;
    if (!yttv) return null;
    for (const k in yttv) {
      const v = yttv[k];
      if (v && v.instance && typeof v.instance.resolveCommand === "function") {
        return v.instance.resolveCommand.bind(v.instance);
      }
    }
    return null;
  };

  // === Minimal UI builders (matches your project shapes) ===
  const overlayPanelItemListRenderer = (items, selectedIndex) => ({
    overlayPanelItemListRenderer: { items, selectedIndex },
  });

  const buttonItem = (title, icon, commands) => {
    const btn = {
      compactLinkRenderer: {
        serviceEndpoint: {
          commandExecutorCommand: { commands },
        },
      },
    };
    if (title) btn.compactLinkRenderer.title = { simpleText: title.title };
    if (title && title.subtitle) btn.compactLinkRenderer.subtitle = { simpleText: title.subtitle };
    if (icon) btn.compactLinkRenderer.icon = { iconType: icon.icon };
    if (icon && icon.secondaryIcon) btn.compactLinkRenderer.secondaryIcon = { iconType: icon.secondaryIcon };
    return btn;
  };

  const ModalCmd = (header, content, id, update) => {
    const titleSubtitleObj = typeof header === "string" ? { title: header, subtitle: "" } : header;
    const overlayPanelHeaderRenderer =
      header && header.overlayPanelHeaderRenderer
        ? header.overlayPanelHeaderRenderer
        : { title: { simpleText: titleSubtitleObj.title } };

    const cmd = {
      openPopupAction: {
        popupType: "MODAL",
        popup: {
          overlaySectionRenderer: {
            overlay: {
              overlayTwoPanelRenderer: {
                actionPanel: {
                  overlayPanelRenderer: {
                    header: { overlayPanelHeaderRenderer },
                    content,
                  },
                },
                backButton: {
                  buttonRenderer: {
                    accessibilityData: { accessibilityData: { label: "Back" } },
                    command: { signalAction: { signal: "POPUP_BACK" } },
                  },
                },
              },
            },
            dismissalCommand: { signalAction: { signal: "POPUP_BACK" } },
          },
        },
        uniqueId: id,
      },
    };

    if (titleSubtitleObj.subtitle) {
      cmd.openPopupAction.popup.overlaySectionRenderer.overlay.overlayTwoPanelRenderer.actionPanel.overlayPanelRenderer.header.overlayPanelHeaderRenderer.subtitle =
        { simpleText: titleSubtitleObj.subtitle };
    }
    if (update) {
      cmd.openPopupAction.shouldMatchUniqueId = true;
      cmd.openPopupAction.updateAction = true;
    }
    return cmd;
  };

  const showModal = (header, content, id, update) => {
    const rc = getResolveCommand();
    if (!rc) throw new Error("YouTube TV resolver not found (window._yttv missing?).");
    rc(ModalCmd(header, content, id, update));
  };

  // === Speed menu (ported from mods/ui/speedUI.js) ===
  const speedSettings = () => {
    const currentSpeed = Number(configRead("videoSpeed"));
    let selectedIndex = 0;
    const maxSpeed = 5;
    const increment = Number(configRead("speedSettingsIncrement")) || 0.25;

    const buttons = [];
    for (let speed = increment; speed <= maxSpeed + 1e-9; speed += increment) {
      const fixedSpeed = Math.round(speed * 100) / 100;
      buttons.push(
        buttonItem(
          { title: `${fixedSpeed}x` },
          null,
          [
            { signalAction: { signal: "POPUP_BACK" } },
            {
              setClientSettingEndpoint: {
                settingDatas: [
                  { clientSettingEnum: { item: "videoSpeed" }, intValue: fixedSpeed.toString() },
                ],
              },
            },
            { customAction: { action: "SET_PLAYER_SPEED", parameters: fixedSpeed.toString() } },
          ]
        )
      );
      if (currentSpeed === fixedSpeed) selectedIndex = buttons.length - 1;
    }

    buttons.push(
      buttonItem(
        { title: "Fix stuttering (1.0001x)" },
        null,
        [
          { signalAction: { signal: "POPUP_BACK" } },
          {
            setClientSettingEndpoint: {
              settingDatas: [{ clientSettingEnum: { item: "videoSpeed" }, intValue: "1.0001" }],
            },
          },
          { customAction: { action: "SET_PLAYER_SPEED", parameters: "1.0001" } },
        ]
      )
    );

    showModal("Playback Speed", overlayPanelItemListRenderer(buttons, selectedIndex), "tt-speed");
  };

  // === Patch resolveCommand like mods/resolveCommand.js does (only what we need) ===
  const patchResolveCommandForSpeed = () => {
    const yttv = window._yttv;
    if (!yttv) return false;

    for (const k in yttv) {
      const v = yttv[k];
      if (!v || !v.instance || typeof v.instance.resolveCommand !== "function") continue;

      if (v.instance.__ttSpeedPatched) return true;

      const original = v.instance.resolveCommand;
      v.instance.resolveCommand = function (cmd, _) {
        // Handle our custom actions (matches your project's behavior)
        const maybeCustom = cmd?.customAction || cmd?.signalAction?.customAction;
        if (maybeCustom && maybeCustom.action) {
          if (maybeCustom.action === "TT_SPEED_SETTINGS_SHOW") {
            speedSettings();
            return true;
          }
          if (maybeCustom.action === "SET_PLAYER_SPEED") {
            const speed = Number(maybeCustom.parameters);
            const vid = document.querySelector("video");
            if (vid) vid.playbackRate = speed;
            return true;
          }
        }

        // Patch playback settings popup to route "speed" to our menu (matches your project)
        if (cmd?.openPopupAction?.uniqueId === "playback-settings") {
          try {
            const items =
              cmd.openPopupAction.popup.overlaySectionRenderer.overlay.overlayTwoPanelRenderer.actionPanel
                .overlayPanelRenderer.content.overlayPanelItemListRenderer.items;

            for (const item of items) {
              if (item?.compactLinkRenderer?.icon?.iconType === "SLOW_MOTION_VIDEO") {
                if (item.compactLinkRenderer.subtitle) item.compactLinkRenderer.subtitle.simpleText = "change speed";
                item.compactLinkRenderer.serviceEndpoint = {
                  clickTrackingParams: "null",
                  signalAction: {
                    customAction: { action: "TT_SPEED_SETTINGS_SHOW", parameters: [] },
                  },
                };
              }
            }
          } catch {}
        }

        // Execute command lists and also catch nested customAction (common on YTTV)
        if (cmd?.commandExecutorCommand?.commands?.length) {
          for (const c of cmd.commandExecutorCommand.commands) {
            const ca =
              c?.customAction ||
              c?.signalAction?.customAction ||
              c?.showEngagementPanelEndpoint?.customAction ||
              c?.playlistEditEndpoint?.customAction;
            if (ca?.action === "TT_SPEED_SETTINGS_SHOW") {
              speedSettings();
            } else if (ca?.action === "SET_PLAYER_SPEED") {
              const speed = Number(ca.parameters);
              const vid = document.querySelector("video");
              if (vid) vid.playbackRate = speed;
            } else {
              original.call(this, c, _);
            }
          }
          return true;
        }

        return original.call(this, cmd, _);
      };

      v.instance.__ttSpeedPatched = true;
      return true;
    }
    return false;
  };

  // === Apply saved speed on playback start (matches mods/ui/speedUI.js) ===
  const hookPlaybackRate = () => {
    const vid = document.querySelector("video");
    if (!vid) return false;
    const onCanPlay = () => {
      const v = document.querySelector("video");
      if (v) v.playbackRate = Number(configRead("videoSpeed"));
    };
    vid.addEventListener("canplay", onCanPlay, { passive: true });
    return true;
  };

  // === Keybind: Blue button (406) / Slash (191) opens speed menu (matches your project) ===
  const hookKeybind = () => {
    const handler = (evt) => {
      if (evt.keyCode === 406 || evt.keyCode === 191) {
        evt.preventDefault();
        evt.stopPropagation();
        if (evt.type === "keydown") speedSettings();
        return false;
      }
      return true;
    };
    document.addEventListener("keydown", handler, true);
    document.addEventListener("keypress", handler, true);
    document.addEventListener("keyup", handler, true);
  };

  // === Boot ===
  const boot = () => {
    const patched = patchResolveCommandForSpeed();
    if (!patched) throw new Error("Could not patch resolveCommand yet. Open any video on tv.youtube.com and run again.");

    hookPlaybackRate();
    hookKeybind();

    // Convenience: you can call this manually anytime
    window.ttSpeedSettings = speedSettings;
  };

  boot();
})();

// === Dark Professional Gradient for #container ===
(() => {
  const applyGradient = () => {
    const el = document.getElementById("container");
    if (!el) {
      console.warn("Element with id 'container' not found.");
      return false;
    }

    // Main dark gradient (TV-style)
    el.style.background = `
      linear-gradient(
        90deg,
        #0f0f0f 20%,
        #161b22 45%,
#24283b 65%,
#2f2438 100%
      )
    `;
    return true;
  };

  // Retry if DOM not ready
  if (!applyGradient()) {
    const observer = new MutationObserver(() => {
      if (applyGradient()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();





