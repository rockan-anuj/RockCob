(() => {
  const origParse = JSON.parse;

  JSON.parse = function (...args) {
    const r = origParse.apply(this, args);

    // Video / player ads
    if (r?.adPlacements) r.adPlacements = [];
    if (r?.adSlots) r.adSlots = [];
    if (r?.playerAds) r.playerAds = false;
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
  if (!raw) {
    console.warn(`Missing localStorage key: ${KEY}. Skipping recurring actions adjustment.`);
    return;
  }

  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    console.warn(`Could not parse ${KEY}. Skipping recurring actions adjustment.`);
    return;
  }

  const data = obj?.data?.data;
  if (!data) {
    console.warn(`Unexpected ${KEY} structure. Skipping recurring actions adjustment.`);
    return;
  }

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


// for speed & equalizer
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

  // === Equalizer Config & Presets ===
  const PRESETS = {
    "Flat / Normal": [0, 0, 0, 0, 0],
    "Bass Booster": [6, 4, 0, 0, 0],
    "Vocal Booster": [-2, 0, 4, 3, 1],
    "Clear Dialogue": [-4, -2, 5, 4, 2],
    "Movie / Cinema": [5, 2, -1, 2, 4],
    "Music / Rock": [4, 2, -2, 2, 3],
    "Treble Booster": [-2, -1, 0, 3, 5],
    "Custom": null
  };
  const BANDS = [60, 230, 910, 4000, 14000];
  const FILTER_TYPES = ["lowshelf", "peaking", "peaking", "peaking", "highshelf"];

  let audioCtx = null;
  let sourceNode = null;
  let filters = [];
  let lastVideoEl = null;

  const applyPreset = (presetName) => {
    let gains = [0, 0, 0, 0, 0];
    if (presetName === "Custom") {
      try {
        const savedGains = localStorage.getItem("ytaf-custom-equalizer-gains");
        if (savedGains) gains = JSON.parse(savedGains);
      } catch (e) {}
    } else {
      gains = PRESETS[presetName] || PRESETS["Flat / Normal"];
    }

    if (filters.length > 0) {
      filters.forEach((filter, idx) => {
        if (filter && audioCtx) {
          filter.gain.setValueAtTime(gains[idx], audioCtx.currentTime);
        }
      });
    }
    localStorage.setItem("ytaf-equalizer-preset", presetName);
    console.log("Applied Equalizer Preset:", presetName, gains);
  };

  const applySavedPreset = () => {
    const saved = localStorage.getItem("ytaf-equalizer-preset") || "Flat / Normal";
    applyPreset(saved);
  };

  const initEqualizer = (video) => {
    if (video === lastVideoEl && sourceNode) return;
    console.log("Hooking equalizer to video element:", video);
    lastVideoEl = video;

    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }

      if (filters.length === 0) {
        filters = BANDS.map((freq, idx) => {
          const filter = audioCtx.createBiquadFilter();
          filter.type = FILTER_TYPES[idx];
          filter.frequency.value = freq;
          filter.Q.value = 1.0;
          filter.gain.value = 0.0;
          return filter;
        });

        let currentNode = filters[0];
        for (let i = 1; i < filters.length; i++) {
          currentNode.connect(filters[i]);
          currentNode = filters[i];
        }
        currentNode.connect(audioCtx.destination);
      }

      if (sourceNode) {
        try {
          sourceNode.disconnect();
        } catch (e) {}
      }

      sourceNode = audioCtx.createMediaElementSource(video);
      sourceNode.connect(filters[0]);

      applySavedPreset();

      const resume = () => {
        if (audioCtx.state === "suspended") {
          audioCtx.resume();
        }
      };
      video.addEventListener("play", resume, { passive: true });
      document.addEventListener("keydown", resume, { once: true, passive: true });
      document.addEventListener("click", resume, { once: true, passive: true });

    } catch (err) {
      console.error("Error setting up audio equalizer:", err);
    }
  };

  const startVideoMonitoring = () => {
    setInterval(() => {
      const video = document.querySelector("video");
      if (video) {
        initEqualizer(video);
      }
    }, 1000);
  };

  // === Custom Sliders overlay implementation ===
  let activeColIdx = 0;
  let eqPanelEl = null;

  const setSliderUI = (colEl, dbVal) => {
    const valueEl = colEl.querySelector(".tt-eq-value");
    const fillEl = colEl.querySelector(".tt-eq-slider-fill");
    const thumbEl = colEl.querySelector(".tt-eq-slider-thumb");
    
    const formatted = dbVal > 0 ? `+${dbVal} dB` : `${dbVal} dB`;
    valueEl.textContent = formatted;
    
    const pct = ((dbVal + 12) / 24) * 100;
    fillEl.style.height = `${pct}%`;
    thumbEl.style.bottom = `${pct}%`;
  };

  const updateBandGain = (idx, dbVal) => {
    if (dbVal < -12) dbVal = -12;
    if (dbVal > 12) dbVal = 12;
    
    if (filters[idx]) {
      filters[idx].gain.setValueAtTime(dbVal, audioCtx.currentTime);
    }
    
    const col = eqPanelEl.querySelector(`.tt-eq-col[data-idx="${idx}"]`);
    if (col) {
      setSliderUI(col, dbVal);
    }
    
    let customGains = [0, 0, 0, 0, 0];
    try {
      const saved = localStorage.getItem("ytaf-custom-equalizer-gains");
      if (saved) customGains = JSON.parse(saved);
    } catch(e) {}
    customGains[idx] = dbVal;
    localStorage.setItem("ytaf-custom-equalizer-gains", JSON.stringify(customGains));
    
    localStorage.setItem("ytaf-equalizer-preset", "Custom");
  };

  const updateFocus = () => {
    const cols = eqPanelEl.querySelectorAll(".tt-eq-col");
    cols.forEach((col, idx) => {
      if (idx === activeColIdx) {
        col.classList.add("focused");
      } else {
        col.classList.remove("focused");
      }
    });
  };

  const handleEqualizerKeyboard = (evt) => {
    if (!eqPanelEl || eqPanelEl.style.display === "none") {
      document.removeEventListener("keydown", handleEqualizerKeyboard, true);
      return;
    }

    const key = evt.keyCode;

    if (key === 37) { // Left
      evt.preventDefault();
      evt.stopPropagation();
      activeColIdx = (activeColIdx - 1 + 5) % 5;
      updateFocus();
    }
    else if (key === 39) { // Right
      evt.preventDefault();
      evt.stopPropagation();
      activeColIdx = (activeColIdx + 1) % 5;
      updateFocus();
    }
    else if (key === 38) { // Up (Increase)
      evt.preventDefault();
      evt.stopPropagation();
      
      let customGains = [0, 0, 0, 0, 0];
      try {
        const saved = localStorage.getItem("ytaf-custom-equalizer-gains");
        if (saved) customGains = JSON.parse(saved);
      } catch (e) {}
      
      const currentVal = customGains[activeColIdx];
      updateBandGain(activeColIdx, currentVal + 1);
    }
    else if (key === 40) { // Down (Decrease)
      evt.preventDefault();
      evt.stopPropagation();
      
      let customGains = [0, 0, 0, 0, 0];
      try {
        const saved = localStorage.getItem("ytaf-custom-equalizer-gains");
        if (saved) customGains = JSON.parse(saved);
      } catch (e) {}
      
      const currentVal = customGains[activeColIdx];
      updateBandGain(activeColIdx, currentVal - 1);
    }
    else if (key === 27 || key === 8) { // Escape or Backspace
      evt.preventDefault();
      evt.stopPropagation();
      closeCustomEqualizerPanel();
    }
  };

  const closeCustomEqualizerPanel = () => {
    if (!eqPanelEl) return;
    eqPanelEl.style.opacity = "0";
    eqPanelEl.style.transform = "translateY(20px)";
    setTimeout(() => {
      eqPanelEl.style.display = "none";
      document.removeEventListener("keydown", handleEqualizerKeyboard, true);
    }, 250);
  };

  const showCustomEqualizerPanel = () => {
    let gains = [0, 0, 0, 0, 0];
    try {
      const savedGains = localStorage.getItem("ytaf-custom-equalizer-gains");
      if (savedGains) gains = JSON.parse(savedGains);
      else localStorage.setItem("ytaf-custom-equalizer-gains", JSON.stringify(gains));
    } catch (e) {}

    eqPanelEl = document.getElementById("tt-eq-panel");
    if (!eqPanelEl) {
      const style = document.createElement("style");
      style.id = "tt-eq-styles";
      style.textContent = `
        #tt-eq-panel {
          position: fixed;
          bottom: 80px;
          right: 80px;
          width: 480px;
          background: rgba(15, 15, 15, 0.9);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 20px;
          padding: 24px;
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
          z-index: 9999999;
          color: #fff;
          font-family: 'Roboto', 'Inter', sans-serif;
          display: flex;
          flex-direction: column;
          gap: 24px;
          box-sizing: border-box;
          transition: opacity 0.25s ease, transform 0.25s ease;
        }
        .tt-eq-header {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .tt-eq-title {
          font-size: 20px;
          font-weight: 700;
          letter-spacing: 0.5px;
          color: #f1f5f9;
        }
        .tt-eq-subtitle {
          font-size: 13px;
          color: #94a3b8;
        }
        .tt-eq-sliders-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
          height: 180px;
        }
        .tt-eq-col {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          flex: 1;
          padding: 10px 4px;
          border-radius: 12px;
          transition: background 0.2s ease;
          cursor: pointer;
        }
        .tt-eq-col.focused {
          background: rgba(255, 255, 255, 0.08);
        }
        .tt-eq-value {
          font-size: 12px;
          font-weight: 600;
          color: #94a3b8;
          width: 50px;
          text-align: center;
        }
        .tt-eq-col.focused .tt-eq-value {
          color: #38bdf8;
          font-weight: 700;
        }
        .tt-eq-slider-container {
          position: relative;
          width: 20px;
          height: 110px;
          display: flex;
          justify-content: center;
        }
        .tt-eq-slider-track {
          position: absolute;
          width: 6px;
          height: 100%;
          background: rgba(255, 255, 255, 0.15);
          border-radius: 3px;
        }
        .tt-eq-col.focused .tt-eq-slider-track {
          background: rgba(255, 255, 255, 0.25);
        }
        .tt-eq-slider-fill {
          position: absolute;
          bottom: 0;
          width: 6px;
          background: linear-gradient(180deg, #38bdf8, #818cf8);
          border-radius: 3px;
        }
        .tt-eq-col.focused .tt-eq-slider-fill {
          background: linear-gradient(180deg, #00f2fe, #4facfe);
          box-shadow: 0 0 10px rgba(0, 242, 254, 0.5);
        }
        .tt-eq-slider-thumb {
          position: absolute;
          width: 14px;
          height: 14px;
          background: #fff;
          border-radius: 50%;
          left: 50%;
          transform: translate(-50%, 50%);
          bottom: 50%;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
        }
        .tt-eq-col.focused .tt-eq-slider-thumb {
          background: #00f2fe;
          box-shadow: 0 0 12px #00f2fe;
        }
        .tt-eq-label {
          font-size: 12px;
          font-weight: 500;
          color: #64748b;
        }
        .tt-eq-col.focused .tt-eq-label {
          color: #f1f5f9;
          font-weight: 700;
        }
        .tt-eq-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          padding-top: 12px;
        }
        .tt-eq-preset-badge {
          font-size: 11px;
          background: rgba(56, 189, 248, 0.15);
          color: #38bdf8;
          padding: 4px 8px;
          border-radius: 20px;
          font-weight: 600;
          border: 1px solid rgba(56, 189, 248, 0.3);
        }
        .tt-eq-help-text {
          font-size: 11px;
          color: #64748b;
        }
      `;
      document.head.appendChild(style);

      eqPanelEl = document.createElement("div");
      eqPanelEl.id = "tt-eq-panel";

      const header = document.createElement("div");
      header.className = "tt-eq-header";
      
      const title = document.createElement("div");
      title.className = "tt-eq-title";
      title.textContent = "Audio Equalizer (Custom)";
      
      const subtitle = document.createElement("div");
      subtitle.className = "tt-eq-subtitle";
      subtitle.textContent = "Left/Right to select, Up/Down to adjust, Esc to save/exit.";
      
      header.appendChild(title);
      header.appendChild(subtitle);
      eqPanelEl.appendChild(header);

      const row = document.createElement("div");
      row.className = "tt-eq-sliders-row";

      BANDS.forEach((freq, idx) => {
        const col = document.createElement("div");
        col.className = "tt-eq-col";
        col.setAttribute("data-idx", idx);

        const value = document.createElement("div");
        value.className = "tt-eq-value";
        value.textContent = "0 dB";
        col.appendChild(value);

        const container = document.createElement("div");
        container.className = "tt-eq-slider-container";

        const track = document.createElement("div");
        track.className = "tt-eq-slider-track";
        container.appendChild(track);

        const fill = document.createElement("div");
        fill.className = "tt-eq-slider-fill";
        container.appendChild(fill);

        const thumb = document.createElement("div");
        thumb.className = "tt-eq-slider-thumb";
        container.appendChild(thumb);

        col.appendChild(container);

        const label = document.createElement("div");
        label.className = "tt-eq-label";
        label.textContent = freq >= 1000 ? `${freq / 1000} kHz` : `${freq} Hz`;
        col.appendChild(label);

        row.appendChild(col);
      });
      eqPanelEl.appendChild(row);

      const footer = document.createElement("div");
      footer.className = "tt-eq-footer";

      const badge = document.createElement("div");
      badge.className = "tt-eq-preset-badge";
      badge.textContent = "Custom Preset";
      footer.appendChild(badge);

      const helpText = document.createElement("div");
      helpText.className = "tt-eq-help-text";
      helpText.textContent = "Click tracks or use remote arrows";
      footer.appendChild(helpText);

      eqPanelEl.appendChild(footer);
      document.body.appendChild(eqPanelEl);

      const cols = eqPanelEl.querySelectorAll(".tt-eq-col");
      cols.forEach((col, idx) => {
        col.addEventListener("click", (evt) => {
          activeColIdx = idx;
          updateFocus();
          
          const container = col.querySelector(".tt-eq-slider-container");
          const rect = container.getBoundingClientRect();
          const clickY = evt.clientY - rect.top;
          const height = rect.height;
          let pct = 1 - (clickY / height);
          if (pct < 0) pct = 0;
          if (pct > 1) pct = 1;
          
          const dbVal = Math.round(pct * 24 - 12);
          updateBandGain(idx, dbVal);
        });
      });
    }

    const cols = eqPanelEl.querySelectorAll(".tt-eq-col");
    cols.forEach((col, idx) => {
      const dbVal = gains[idx];
      setSliderUI(col, dbVal);
    });

    eqPanelEl.style.opacity = "0";
    eqPanelEl.style.transform = "translateY(20px)";
    eqPanelEl.style.display = "flex";
    
    eqPanelEl.offsetHeight; // trigger reflow
    
    eqPanelEl.style.opacity = "1";
    eqPanelEl.style.transform = "translateY(0)";

    activeColIdx = 0;
    updateFocus();
    
    document.addEventListener("keydown", handleEqualizerKeyboard, true);
  };

  // === YouTube TV "resolveCommand" finder ===
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

  // === Minimal UI builders ===
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

  // === Speed menu ===
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

  // === Equalizer menu ===
  const eqSettings = () => {
    const currentPreset = localStorage.getItem("ytaf-equalizer-preset") || "Flat / Normal";
    let selectedIndex = 1;

    const buttons = [];
    
    buttons.push(
      buttonItem(
        { title: "Configure Custom Slider..." },
        { icon: "VOLUME_UP" },
        [
          { signalAction: { signal: "POPUP_BACK" } },
          { customAction: { action: "TT_CUSTOM_EQ_SHOW", parameters: [] } }
        ]
      )
    );

    Object.keys(PRESETS).forEach((presetName, idx) => {
      buttons.push(
        buttonItem(
          { title: presetName },
          null,
          [
            { signalAction: { signal: "POPUP_BACK" } },
            { customAction: { action: "SET_EQ_PRESET", parameters: presetName } }
          ]
        )
      );
      if (currentPreset === presetName) selectedIndex = idx + 1;
    });

    showModal("Audio Equalizer", overlayPanelItemListRenderer(buttons, selectedIndex), "tt-eq");
  };
  // === Patch resolveCommand to route speed, equalizer and custom slider commands ===
  const patchResolveCommandForMods = () => {
    const yttv = window._yttv;
    if (!yttv) return false;

    for (const k in yttv) {
      const v = yttv[k];
      if (!v || !v.instance || typeof v.instance.resolveCommand !== "function") continue;

      if (v.instance.__ttModsPatched) return true;

      const original = v.instance.resolveCommand;
      v.instance.resolveCommand = function (cmd, _) {
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
          if (maybeCustom.action === "TT_EQ_SETTINGS_SHOW") {
            eqSettings();
            return true;
          }
          if (maybeCustom.action === "SET_EQ_PRESET") {
            applyPreset(maybeCustom.parameters);
            return true;
          }
          if (maybeCustom.action === "TT_CUSTOM_EQ_SHOW") {
            showCustomEqualizerPanel();
            return true;
          }
        }

        // Patch playback settings popup to insert equalizer item below speed item
        if (cmd?.openPopupAction?.uniqueId === "playback-settings") {
          try {
            const items =
              cmd.openPopupAction.popup.overlaySectionRenderer.overlay.overlayTwoPanelRenderer.actionPanel
                .overlayPanelRenderer.content.overlayPanelItemListRenderer.items;

            let speedIdx = -1;
            for (let i = 0; i < items.length; i++) {
              const item = items[i];
              if (item?.compactLinkRenderer?.icon?.iconType === "SLOW_MOTION_VIDEO") {
                speedIdx = i;
                if (item.compactLinkRenderer.subtitle) item.compactLinkRenderer.subtitle.simpleText = "change speed";
                item.compactLinkRenderer.serviceEndpoint = {
                  clickTrackingParams: "null",
                  signalAction: {
                    customAction: { action: "TT_SPEED_SETTINGS_SHOW", parameters: [] },
                  },
                };
              }
            }

            // Insert Equalizer item
            const hasEq = items.some(item => item?.compactLinkRenderer?.title?.simpleText === "Audio Equalizer");
            if (!hasEq) {
              const activePreset = localStorage.getItem("ytaf-equalizer-preset") || "Flat / Normal";
              const eqBtn = buttonItem(
                { title: "Audio Equalizer", subtitle: activePreset },
                { icon: "VOLUME_UP" },
                [
                  { signalAction: { signal: "POPUP_BACK" } },
                  { signalAction: { customAction: { action: "TT_EQ_SETTINGS_SHOW", parameters: [] } } }
                ]
              );
              if (speedIdx !== -1) {
                items.splice(speedIdx + 1, 0, eqBtn);
              } else {
                items.push(eqBtn);
              }
            }
          } catch {}
        }

        // Execute command lists and also catch nested customActions
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
            } else if (ca?.action === "TT_EQ_SETTINGS_SHOW") {
              eqSettings();
            } else if (ca?.action === "SET_EQ_PRESET") {
              applyPreset(ca.parameters);
            } else if (ca?.action === "TT_CUSTOM_EQ_SHOW") {
              showCustomEqualizerPanel();
            } else {
              original.call(this, c, _);
            }
          }
          return true;
        }

        return original.call(this, cmd, _);
      };

      v.instance.__ttModsPatched = true;
      return true;
    }
    return false;
  };

  // === Apply saved speed on playback start ===
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

  // === Keybind: Blue button (406) / Slash (191) opens speed menu ===
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

  // === Boot with auto-retry ===
  const boot = () => {
    const patched = patchResolveCommandForMods();
    if (!patched) {
      console.log("Could not patch resolveCommand yet. Retrying in 1s...");
      setTimeout(boot, 1000);
      return;
    }

    console.log("Successfully patched resolveCommand with speed & equalizer mods!");
    hookPlaybackRate();
    hookKeybind();
    startVideoMonitoring();

    window.ttSpeedSettings = speedSettings;
    window.ttEqSettings = eqSettings;
    window.ttCustomEqPanel = showCustomEqualizerPanel;
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
