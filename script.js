(() => {
  const map = L.map("map", {
    preferCanvas: true,
    doubleClickZoom: false
  }).setView([36.70, 137.05], 9);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  const listEl = document.getElementById("pointList");
  const detailEl = document.getElementById("detail");
  const mobileMapDetail = document.getElementById("mobileMapDetail");
  const shootProgress = document.getElementById("shootProgress");
  const shootProgressReal = document.getElementById("shootProgressReal");
  const reshootAlert = document.getElementById("reshootAlert");

  const listSearchEl = document.getElementById("listNumberSearch");
  const listSearchButton = document.getElementById("listSearchButton");
  const fitButton = document.getElementById("fitButton");

  const addPointSection = document.getElementById("addPointSection");
  const toggleAddPoint = document.getElementById("toggleAddPoint");
  const addPointBody = document.getElementById("addPointBody");
  const addNumber = document.getElementById("addNumber");
  const addCoordinate = document.getElementById("addCoordinate");
  const addPointButton = document.getElementById("addPointButton");
  const clearAddedButton = document.getElementById("clearAddedButton");
  const addMessage = document.getElementById("addMessage");

  const showAllShoot = document.getElementById("showAllShoot");
  const showUnshot = document.getElementById("showUnshot");
  const showShot = document.getElementById("showShot");
  const backToTop = document.getElementById("backToTop");
  const jumpToMapButton = document.getElementById("jumpToMapButton");

  const markerGroup = L.featureGroup().addTo(map);
  const markerMap = new Map();
  const rowMap = new Map();
  const addressCache = new Map();

  let selected = null;
  let highlightedNumber = null;
  let shootFilter = "all";

  const DUPLICATE_PAIRS = [
    [74, 75],
    [177, 178],
    [193, 194],
    [281, 282]
  ];

  function safeGet(key, fallback = "") {
    try { return localStorage.getItem(key) ?? fallback; }
    catch { return fallback; }
  }

  function safeSet(key, value) {
    try { localStorage.setItem(key, value); } catch {}
  }

  function loadAddedRows() {
    try {
      const parsed = JSON.parse(safeGet("coordinatePinAddedRows", "[]"));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function loadOverrides() {
    try {
      const parsed = JSON.parse(safeGet("coordinatePinCoordinateOverrides", "{}"));
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function loadShotState() {
    try {
      const parsed = JSON.parse(safeGet("coordinatePinShotState", "{}"));
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function loadUnnecessaryOverrides() {
    try {
      const parsed = JSON.parse(safeGet("coordinatePinUnnecessaryOverrides", "{}"));
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function loadGenericFlagState(key) {
    try {
      const parsed = JSON.parse(safeGet(key, "{}"));
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  let addedRows = loadAddedRows();
  let coordinateOverrides = loadOverrides();
  let unnecessaryOverrides = loadUnnecessaryOverrides();
  let reshootNeeded = loadGenericFlagState("coordinatePinReshootNeeded");
  let reshootDone = loadGenericFlagState("coordinatePinReshootDone");
  let shotState = loadShotState();

  function normalizeDuplicateShotState() {
    let changed = false;
    DUPLICATE_PAIRS.forEach(pair => {
      const checked = pair.some(n => shotState[String(n)] === true);
      if (checked) {
        pair.forEach(n => {
          if (shotState[String(n)] !== true) {
            shotState[String(n)] = true;
            changed = true;
          }
        });
      }
    });
    if (changed) {
      try { localStorage.setItem("coordinatePinShotState", JSON.stringify(shotState)); } catch {}
      pushToCloud();
    }
  }

  normalizeDuplicateShotState();

  function saveAddedRows() {
    safeSet("coordinatePinAddedRows", JSON.stringify(addedRows));
    pushToCloud();
  }

  function saveOverrides() {
    safeSet("coordinatePinCoordinateOverrides", JSON.stringify(coordinateOverrides));
    pushToCloud();
  }

  function saveUnnecessaryOverrides() {
    safeSet("coordinatePinUnnecessaryOverrides", JSON.stringify(unnecessaryOverrides));
    pushToCloud();
  }

  function saveReshootNeeded() {
    safeSet("coordinatePinReshootNeeded", JSON.stringify(reshootNeeded));
    pushToCloud();
  }

  function saveReshootDone() {
    safeSet("coordinatePinReshootDone", JSON.stringify(reshootDone));
    pushToCloud();
  }

  function needsReshoot(r) {
    if (isAutoShot(r)) return false;
    return reshootNeeded[String(r.number)] === true && reshootDone[String(r.number)] !== true;
  }

  function reshootResolved(r) {
    if (isAutoShot(r)) return false;
    return reshootDone[String(r.number)] === true;
  }

  function setReshootNeeded(r, checked) {
    if (checked) {
      reshootNeeded[String(r.number)] = true;
      delete reshootDone[String(r.number)];
      saveReshootDone();
    } else {
      delete reshootNeeded[String(r.number)];
      delete reshootDone[String(r.number)];
      saveReshootDone();
    }
    saveReshootNeeded();
  }

  function setReshootDone(r, checked) {
    if (checked) {
      reshootDone[String(r.number)] = true;
      // 再撮影済み＝撮影は完了しているので、撮影済みフラグも一緒に立てる
      if (!isAutoShot(r) && shotState[String(r.number)] !== true) {
        shotState[String(r.number)] = true;
        saveShotState();
      }
    } else {
      delete reshootDone[String(r.number)];
    }
    saveReshootDone();
  }

  function saveShotState() {
    safeSet("coordinatePinShotState", JSON.stringify(shotState));
    pushToCloud();
  }

  // ---------- Firebase同期 ----------
  const syncStatusEl = document.getElementById("syncStatus");
  let suppressCloudPush = false;
  let lastSyncedSnapshot = "";

  function setSyncStatus(state) {
    if (!syncStatusEl) return;
    syncStatusEl.classList.remove("status-saving", "status-synced", "status-error");
    const labels = {
      connecting: "同期: 接続中…",
      saving: "同期: 保存中…",
      synced: "同期: 完了",
      error: "同期: エラー（未接続）"
    };
    syncStatusEl.textContent = labels[state] || "";
    if (state === "saving") syncStatusEl.classList.add("status-saving");
    if (state === "synced") syncStatusEl.classList.add("status-synced");
    if (state === "error") syncStatusEl.classList.add("status-error");
  }

  setSyncStatus("connecting");

  function currentCloudPayload() {
    return { shotState, coordinateOverrides, unnecessaryOverrides, reshootNeeded, reshootDone, addedRows };
  }

  function pushToCloud() {
    if (suppressCloudPush) return;
    if (!window.PinMapSync) return;
    const payload = currentCloudPayload();
    lastSyncedSnapshot = JSON.stringify(payload);
    window.PinMapSync.save(payload);
  }

  window.addEventListener("pinmap-sync-ready", () => setSyncStatus("synced"));
  window.addEventListener("pinmap-sync-saving", () => setSyncStatus("saving"));
  window.addEventListener("pinmap-sync-saved", () => setSyncStatus("synced"));
  window.addEventListener("pinmap-sync-error", () => setSyncStatus("error"));

  // クラウドにまだデータが無い（この端末が最初の同期）場合、今のローカルデータで作成する
  window.addEventListener("pinmap-sync-empty", () => {
    pushToCloud();
  });

  // 他の端末（またはクラウド）から更新が来たら、ローカルへ反映する
  window.addEventListener("pinmap-remote-update", (e) => {
    const data = e.detail || {};
    const incoming = {
      shotState: (data.shotState && typeof data.shotState === "object") ? data.shotState : {},
      coordinateOverrides: (data.coordinateOverrides && typeof data.coordinateOverrides === "object") ? data.coordinateOverrides : {},
      unnecessaryOverrides: (data.unnecessaryOverrides && typeof data.unnecessaryOverrides === "object") ? data.unnecessaryOverrides : {},
      reshootNeeded: (data.reshootNeeded && typeof data.reshootNeeded === "object") ? data.reshootNeeded : {},
      reshootDone: (data.reshootDone && typeof data.reshootDone === "object") ? data.reshootDone : {},
      addedRows: Array.isArray(data.addedRows) ? data.addedRows : []
    };

    const incomingSnapshot = JSON.stringify(incoming);
    if (incomingSnapshot === lastSyncedSnapshot) {
      setSyncStatus("synced");
      return;
    }
    lastSyncedSnapshot = incomingSnapshot;

    suppressCloudPush = true;
    shotState = incoming.shotState;
    coordinateOverrides = incoming.coordinateOverrides;
    unnecessaryOverrides = incoming.unnecessaryOverrides;
    reshootNeeded = incoming.reshootNeeded;
    reshootDone = incoming.reshootDone;
    addedRows = incoming.addedRows;

    safeSet("coordinatePinShotState", JSON.stringify(shotState));
    safeSet("coordinatePinCoordinateOverrides", JSON.stringify(coordinateOverrides));
    safeSet("coordinatePinUnnecessaryOverrides", JSON.stringify(unnecessaryOverrides));
    safeSet("coordinatePinReshootNeeded", JSON.stringify(reshootNeeded));
    safeSet("coordinatePinReshootDone", JSON.stringify(reshootDone));
    safeSet("coordinatePinAddedRows", JSON.stringify(addedRows));

    allRows = buildRows();
    rebuildUI();

    // 選択中の一覧行のハイライトと、開いている詳細パネルの内容を
    // 他端末からの更新に合わせて再同期する（rebuildUIは一覧の再構築のみ行うため）。
    if (selected) {
      const updatedSelected = allRows.find(x => x.number === selected.number);
      if (updatedSelected) selectRow(updatedSelected, false);
    }

    setSyncStatus("synced");
    suppressCloudPush = false;
  });

  function buildRows() {
    const base = ROWS.map(r => {
      const override = coordinateOverrides[String(r.number)];
      const row = override
        ? {
            ...r,
            coordRaw: `${override.lat}, ${override.lng}`,
            coordType: "coordinate",
            lat: override.lat,
            lng: override.lng,
            overridden: true
          }
        : { ...r };

      if (unnecessaryOverrides[String(r.number)]) {
        // 座標が分かっている場合は消さずに残す（ピンは表示したまま、見た目だけ「不要」扱いにする）
        return { ...row, markedUnnecessary: true };
      }
      return row;
    });

    const baseNums = new Set(base.map(r => r.number));
    const extras = addedRows
      .filter(r => !baseNums.has(r.number))
      .map(r => unnecessaryOverrides[String(r.number)] ? { ...r, markedUnnecessary: true } : r);

    return [...base, ...extras].sort((a,b) => a.number - b.number);
  }

  let allRows = buildRows();

  function pairedNumbers(number) {
    const pair = DUPLICATE_PAIRS.find(p => p.includes(number));
    return pair ? pair : [number];
  }

  function isAutoShot(r) {
    return r.coordType === "unnecessary" || r.markedUnnecessary === true;
  }

  function isUserModified(r) {
    return !!r.userAdded || !!r.overridden || !!r.markedUnnecessary;
  }

  function removeUserModification(r) {
    if (!isUserModified(r)) return;

    const label = r.userAdded
      ? `番号 ${r.number} の追加地点を削除しますか？`
      : r.markedUnnecessary
      ? `番号 ${r.number} の「不要」指定を解除しますか？`
      : `番号 ${r.number} に登録した座標を元に戻しますか？`;

    if (!confirm(label)) return;

    if (r.userAdded) {
      addedRows = addedRows.filter(x => x.number !== r.number);
      saveAddedRows();
    }

    if (r.overridden) {
      delete coordinateOverrides[String(r.number)];
      saveOverrides();
    }

    if (r.markedUnnecessary) {
      delete unnecessaryOverrides[String(r.number)];
      saveUnnecessaryOverrides();
    }

    delete shotState[String(r.number)];
    saveShotState();

    allRows = buildRows();
    selected = null;
    highlightedNumber = null;
    rebuildUI(false);

    detailEl.innerHTML = `<div class="detail-empty">追加・更新した座標を削除しました。</div>`;
    clearMobileDetail();

    if (markerGroup.getLayers().length) {
      map.fitBounds(markerGroup.getBounds().pad(0.04));
    }
  }

  function markUnnecessary(r) {
    if (r.markedUnnecessary || isAutoShot(r)) return;
    if (!confirm(`番号 ${r.number} を「不要」に変更しますか？\n（撮影対象から除外されます。いつでも元に戻せます）`)) return;

    unnecessaryOverrides[String(r.number)] = true;
    saveUnnecessaryOverrides();

    if (reshootNeeded[String(r.number)] || reshootDone[String(r.number)]) {
      delete reshootNeeded[String(r.number)];
      delete reshootDone[String(r.number)];
      saveReshootNeeded();
      saveReshootDone();
    }

    allRows = buildRows();
    rebuildUI(false);

    const updated = allRows.find(x => x.number === r.number);
    if (updated) selectRow(updated, false);
  }

  function isShot(r) {
    return isAutoShot(r) || shotState[String(r.number)] === true;
  }

  function googleMapsUrl(r) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${r.lat},${r.lng}`)}`;
  }

  function appleMapsUrl(r) {
    return `https://maps.apple.com/?ll=${encodeURIComponent(`${r.lat},${r.lng}`)}&q=${encodeURIComponent(`番号${r.number}`)}`;
  }

  function isIOS() {
    const ua = navigator.userAgent || "";
    // iPadOS13以降はUAがMacと同じになるため、タッチ対応も合わせて判定する
    const isIPadOS = ua.includes("Macintosh") && navigator.maxTouchPoints > 1;
    return /iPhone|iPad|iPod/.test(ua) || isIPadOS;
  }

  function streetViewUrl(r) {
    return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${encodeURIComponent(`${r.lat},${r.lng}`)}`;
  }

  function openStreetView(r) {
    if (!r || r.coordType !== "coordinate") return;
    window.open(streetViewUrl(r), "_blank", "noopener");
  }

  function compactAddress(address) {
    if (!address || address === "住所を取得できませんでした。") return "住所を取得しています…";

    const cleaned = String(address)
      .replace(/,\s*日本\s*$/u, "")
      .replace(/,\s*\d{3}-\d{4}\s*$/u, "")
      .trim();

    const parts = cleaned.split(",").map(v => v.trim()).filter(Boolean);
    const short = parts.slice(0, 3);
    return short.length ? short.join(" / ") : cleaned;
  }

  function popupHtml(r, addressText = "住所を取得しています…") {
    return `
      <div class="pin-popup-card">
        <div class="pin-popup-title">${r.number}</div>
        <div class="pin-popup-coord">${r.coordRaw}</div>
        <div class="pin-popup-address">${compactAddress(addressText)}</div>
        <div class="pin-popup-note">2回クリックでStreet View</div>
      </div>
    `;
  }

  function updateMarkerPopup(r, addressText = "住所を取得しています…") {
    const marker = markerMap.get(r.number);
    if (!marker || !marker.getPopup || !marker.getPopup()) return;
    marker.setPopupContent(popupHtml(r, addressText));
  }

  function iconFor(r) {
    const classes = [
      r.markedUnnecessary ? "unnecessary-pin" :
        needsReshoot(r) ? "reshoot-pin" : (reshootResolved(r) ? "reshoot-done-pin" : (isShot(r) ? "shot-pin" : "")),
      highlightedNumber === r.number ? "selected-pin" : ""
    ].filter(Boolean).join(" ");

    return L.divIcon({
      className: "number-pin",
      html: `<span class="${classes}">${r.number}</span>`,
      iconSize: [44, 44],
      iconAnchor: [22, 22],
      popupAnchor: [0, -22]
    });
  }

  function coordDisplay(r) {
    if (r.coordType === "coordinate") return r.coordRaw;
    if (r.coordType === "unnecessary") return "不要";
    if (r.coordType === "unknown") return "不明";
    if (r.coordType === "blank") return "座標なし";
    return r.coordRaw || "座標なし";
  }

  function statusClass(r) {
    if (r.coordType === "unnecessary") return "status-unnecessary";
    if (r.coordType === "unknown") return "status-unknown";
    if (r.coordType === "blank") return "status-blank";
    if (r.coordType === "note") return "status-note";
    return "";
  }


  function isMobile() {
    return window.matchMedia("(max-width: 820px)").matches;
  }

  function setMobileDetail(html) {
    if (!mobileMapDetail) return;
    const hasDetail = Boolean(html && html.trim());
    mobileMapDetail.innerHTML = hasDetail ? html : "";

    const mapPanel = document.getElementById("mapPanel");
    if (mapPanel) {
      mapPanel.classList.toggle("mobile-detail-open", hasDetail && isMobile());
    }
  }

  function clearMobileDetail() {
    if (mobileMapDetail) mobileMapDetail.innerHTML = "";

    const mapPanel = document.getElementById("mapPanel");
    if (mapPanel) mapPanel.classList.remove("mobile-detail-open");
  }

  function bindMobileDetailHandlers(r) {
    if (!mobileMapDetail) return;
    const mobileShot = mobileMapDetail.querySelector("#mobileDetailShotCheck");
    if (mobileShot) {
      mobileShot.addEventListener("change", e => setShot(r, e.target.checked));
    }
  }

  function centerSelectedMarkerOnMobile(r) {
    if (!isMobile() || !r || r.coordType !== "coordinate") return;

    const marker = markerMap.get(r.number);
    if (!marker) return;

    /*
      Detail insertion changes the map container height on phones.
      Wait for that layout change, then tell Leaflet the real size,
      and only then center the selected marker.
    */
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        map.invalidateSize({ pan: false, animate: false });

        const currentZoom = Math.max(map.getZoom(), 16);
        map.setView(marker.getLatLng(), currentZoom, {
          animate: false
        });
      });
    });
  }

  function scrollToMobileMap() {
    if (!isMobile()) return;

    const mapPanel = document.getElementById("mapPanel");
    if (!mapPanel) return;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const header = document.querySelector(".app-header");
        const headerHeight = header ? header.getBoundingClientRect().height : 0;
        const top = mapPanel.getBoundingClientRect().top
          + window.scrollY
          - headerHeight
          - 4;

        window.scrollTo({
          top: Math.max(0, top),
          behavior: "smooth"
        });
      });
    });
  }

  function updateTopButtonVisibility() {
    if (!backToTop) return;

    const scrollTop = Math.max(
      window.scrollY || 0,
      document.documentElement?.scrollTop || 0,
      document.body?.scrollTop || 0
    );
    backToTop.classList.toggle("visible", scrollTop > 240);
  }

  function isConfirmedShot(r) {
    return isShot(r) && !needsReshoot(r);
  }

  function updateCount() {
    const shotCount = allRows.filter(r => isConfirmedShot(r)).length;
    if (shootProgress) shootProgress.textContent = `撮影済み ${shotCount} / ${allRows.length}`;

    const targetRows = allRows.filter(r => !isAutoShot(r));
    const targetShotCount = targetRows.filter(r => isConfirmedShot(r)).length;
    if (shootProgressReal) {
      shootProgressReal.textContent = `（不要を除く: ${targetShotCount} / ${targetRows.length}）`;
    }

    const reshootCount = allRows.filter(r => needsReshoot(r)).length;
    if (reshootAlert) {
      if (reshootCount > 0) {
        reshootAlert.textContent = `⚠ 位置情報ズレ ${reshootCount}件`;
        reshootAlert.style.display = "";
      } else {
        reshootAlert.textContent = "";
        reshootAlert.style.display = "none";
      }
    }
  }

  function rowVisibleByShoot(r) {
    if (shootFilter === "shot") return isConfirmedShot(r);
    if (shootFilter === "unshot") return !isConfirmedShot(r);
    return true;
  }

  function applyShootFilter() {
    allRows.forEach(r => {
      const el = rowMap.get(r.number);
      if (el) el.style.display = rowVisibleByShoot(r) ? "" : "none";
    });

    [showAllShoot, showUnshot, showShot].forEach(btn => btn?.classList.remove("active"));
    if (shootFilter === "all") showAllShoot?.classList.add("active");
    if (shootFilter === "unshot") showUnshot?.classList.add("active");
    if (shootFilter === "shot") showShot?.classList.add("active");
  }

  function refreshRowAndMarker(number) {
    const r = allRows.find(x => x.number === number);
    if (!r) return;

    const row = rowMap.get(number);
    if (row) {
      row.classList.toggle("shot", isConfirmedShot(r));
      row.classList.toggle("reshoot-row", needsReshoot(r));
      row.classList.toggle("reshoot-done-row", reshootResolved(r));
      const box = row.querySelector(".shoot-check input");
      if (box) box.checked = isShot(r);

      const coordWrap = row.querySelector(".point-coord-wrap");
      if (coordWrap) {
        coordWrap.querySelector(".point-flag-reshoot, .point-flag-reshoot-done")?.remove();
        if (needsReshoot(r) || reshootResolved(r)) {
          const flag = document.createElement("span");
          if (needsReshoot(r)) {
            flag.className = "point-flag point-flag-reshoot";
            flag.textContent = "位置情報ズレ";
          } else {
            flag.className = "point-flag point-flag-reshoot-done";
            flag.textContent = "再撮影済み";
          }
          coordWrap.appendChild(flag);
        }
      }
    }

    const marker = markerMap.get(number);
    if (marker) {
      marker.setIcon(iconFor(r));
      if (typeof marker.setZIndexOffset === "function" && selected?.number !== number) {
        marker.setZIndexOffset(0);
      }
    }
  }

  function refreshSelectedMarker(previousNumber = null) {
    if (previousNumber !== null && previousNumber !== undefined) {
      const prev = allRows.find(x => x.number === previousNumber);
      const prevMarker = markerMap.get(previousNumber);
      if (prev && prevMarker) {
        prevMarker.setIcon(iconFor(prev));
        if (typeof prevMarker.setZIndexOffset === "function") prevMarker.setZIndexOffset(0);
      }
    }

    if (highlightedNumber !== null) {
      const current = allRows.find(x => x.number === highlightedNumber);
      const currentMarker = markerMap.get(highlightedNumber);
      if (current && currentMarker) {
        currentMarker.setIcon(iconFor(current));
        if (typeof currentMarker.setZIndexOffset === "function") currentMarker.setZIndexOffset(1000);
      }
    }
  }

  function clearHighlightedMarker(number = highlightedNumber) {
    if (number === null || number === undefined) return;
    const r = allRows.find(x => x.number === number);
    const marker = markerMap.get(number);

    if (highlightedNumber === number) highlightedNumber = null;

    if (r && marker) {
      marker.setIcon(iconFor(r));
      if (typeof marker.setZIndexOffset === "function") marker.setZIndexOffset(0);
    }
  }

  function setShot(r, checked) {
    if (isAutoShot(r)) return;

    const nums = pairedNumbers(r.number);
    nums.forEach(n => {
      const rr = allRows.find(x => x.number === n);
      if (!rr || isAutoShot(rr)) return;

      if (checked) shotState[String(n)] = true;
      else delete shotState[String(n)];
    });

    saveShotState();

    nums.forEach(refreshRowAndMarker);
    updateCount();
    applyShootFilter();

    if (selected && nums.includes(selected.number)) {
      const box = document.getElementById("detailShotCheck");
      if (box) box.checked = isShot(selected);
      const mobileBox = document.getElementById("mobileDetailShotCheck");
      if (mobileBox) mobileBox.checked = isShot(selected);
    }
  }

  function reshootBlockHtml(r, idPrefix, includeUnnecessaryButton = false) {
    const flagged = reshootNeeded[String(r.number)] === true;
    const done = reshootDone[String(r.number)] === true;
    return `
      <div class="detail-reshoot-row">
        <div class="detail-reshoot-checks">
          <label class="detail-reshoot-inline"><input id="${idPrefix}ReshootNeeded" type="checkbox" ${flagged ? "checked" : ""}><span>位置情報ズレあり</span></label>
          ${flagged ? `<label class="detail-reshoot-inline detail-reshoot-done"><input id="${idPrefix}ReshootDone" type="checkbox" ${done ? "checked" : ""}><span>再撮影済み</span></label>` : ""}
        </div>
        ${includeUnnecessaryButton && !isAutoShot(r) ? `<button type="button" id="${idPrefix}MarkUnnecessaryBtn" class="mark-unnecessary-button">この番号を「不要」にする</button>` : ""}
      </div>
    `;
  }

  function bindReshootHandlers(r, idPrefix) {
    document.getElementById(`${idPrefix}ReshootNeeded`)?.addEventListener("change", e => {
      setReshootNeeded(r, e.target.checked);
      refreshRowAndMarker(r.number);
      updateCount();
      applyShootFilter();
      selectRow(r, false);
    });
    document.getElementById(`${idPrefix}ReshootDone`)?.addEventListener("change", e => {
      setReshootDone(r, e.target.checked);
      refreshRowAndMarker(r.number);
      updateCount();
      applyShootFilter();
      selectRow(r, false);
    });
    document.getElementById(`${idPrefix}MarkUnnecessaryBtn`)?.addEventListener("click", () => markUnnecessary(r));
  }

  async function selectRow(r, zoomTo = true) {
    selected = r;

    /* Keep the highlighted map pin in sync with whatever was just selected
       (pin click, list click, or search) on both mobile and PC. If the
       newly selected row has no map pin, clear any stale highlight instead
       of leaving the previous selection lit up on the map. */
    if (r.coordType === "coordinate") {
      const previous = highlightedNumber;
      highlightedNumber = r.number;
      refreshSelectedMarker(previous === r.number ? null : previous);
    } else if (highlightedNumber !== null) {
      clearHighlightedMarker();
    }

    rowMap.forEach(el => el.classList.remove("active"));
    const row = rowMap.get(r.number);
    if (row) {
      row.classList.add("active");

      /* PC only: keep the selected item visible in the right-side list. */
      if (!isMobile()) {
        row.scrollIntoView({
          block: "center",
          behavior: "smooth"
        });
      }
    }

    if (r.coordType !== "coordinate") {
      const canTrackShot = isAutoShot(r);
      const shotStatusHtml = isAutoShot(r)
        ? `<span class="detail-auto-shot">不要</span>`
        : "";
      const nonCoordHtml = `
        <div class="detail-headerline">
          <span class="detail-badge">選択地点</span>
          <h2 class="detail-number"><strong>${r.number}</strong></h2>
          ${shotStatusHtml}
        </div>
        <p class="detail-coord ${statusClass(r)}">${coordDisplay(r)}</p>
        <p class="detail-address">この番号には現在、地図ピンを表示できる座標がありません。座標を登録すると撮影済みチェックができるようになります。</p>
        ${isAutoShot(r) ? "" : `<button type="button" id="markUnnecessaryBtn" class="mark-unnecessary-button">この番号を「不要」にする</button>`}
      `;
      detailEl.innerHTML = nonCoordHtml;

      if (!isAutoShot(r)) {
        document.getElementById("markUnnecessaryBtn")?.addEventListener("click", () => markUnnecessary(r));
      }

      if (isMobile()) {
        setMobileDetail(`
          <div class="detail-headerline">
            <span class="detail-badge">選択地点</span>
            <h2 class="detail-number"><strong>${r.number}</strong></h2>
            ${shotStatusHtml}
          </div>
          <p class="detail-coord ${statusClass(r)}">${coordDisplay(r)}</p>
          <p class="detail-address">この番号には現在、地図ピンを表示できる座標がありません。座標を登録すると撮影済みチェックができるようになります。</p>
        `);
        bindMobileDetailHandlers(r);
      }

      return;
    }

    detailEl.innerHTML = `
      <div class="detail-headerline">
        <span class="detail-badge">選択地点</span>
        <h2 class="detail-number"><strong>${r.number}</strong></h2>
        <label class="detail-shot-inline"><input id="detailShotCheck" type="checkbox" ${isShot(r) ? "checked" : ""}><span>撮影済み</span></label>
      </div>
      <p class="detail-coord">${r.coordRaw}</p>
      <p class="detail-address" id="addressText">住所を取得しています…</p>
      ${r.markedUnnecessary ? `<p class="detail-unnecessary-note">この番号は「不要」に変更されています</p>` : ""}
      <p class="muted detail-hint">地図のピンを2回クリックするとストリートビューを別タブで開きます。</p>
      <div class="detail-actions">
        <a class="map-link street" href="${streetViewUrl(r)}" target="_blank" rel="noopener">ストリートビュー</a>
        <a class="map-link google" href="${googleMapsUrl(r)}" target="_blank" rel="noopener">Googleマップ</a>
      </div>
      ${reshootBlockHtml(r, "detail", true)}
    `;

    document.getElementById("detailShotCheck")?.addEventListener("change", e => setShot(r, e.target.checked));
    bindReshootHandlers(r, "detail");

    if (isMobile()) {
      setMobileDetail(`
        <div class="detail-headerline">
          <span class="detail-badge">選択地点</span>
          <h2 class="detail-number"><strong>${r.number}</strong></h2>
          <label class="detail-shot-inline"><input id="mobileDetailShotCheck" type="checkbox" ${isShot(r) ? "checked" : ""}><span>撮影済み</span></label>
        </div>
        <p class="detail-coord">${r.coordRaw}</p>
        <p class="detail-address" id="mobileAddressText">住所を取得しています…</p>
        ${r.markedUnnecessary ? `<p class="detail-unnecessary-note">この番号は「不要」に変更されています</p>` : ""}
        <div class="detail-actions">
          <a class="map-link street" href="${streetViewUrl(r)}" target="_blank" rel="noopener">ストリートビュー</a>
          ${isIOS()
            ? `<a class="map-link google" href="${appleMapsUrl(r)}" target="_blank" rel="noopener">Appleマップ</a>`
            : `<a class="map-link google" href="${googleMapsUrl(r)}" target="_blank" rel="noopener">Googleマップ</a>`
          }
        </div>
        ${reshootBlockHtml(r, "mobile")}
      `);
      bindMobileDetailHandlers(r);
      bindReshootHandlers(r, "mobile");
      centerSelectedMarkerOnMobile(r);
    }

    const marker = markerMap.get(r.number);
    if (zoomTo && marker) {
      map.setView(marker.getLatLng(), 17);
      if (!isMobile() && marker.getPopup && marker.getPopup()) {
        marker.openPopup();
      }
    }

    const addressText = document.getElementById("addressText");
    try {
      const url = new URL("https://nominatim.openstreetmap.org/reverse");
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("lat", r.lat);
      url.searchParams.set("lon", r.lng);
      url.searchParams.set("zoom", "18");
      url.searchParams.set("accept-language", "ja");
      const res = await fetch(url);
      if (!res.ok) throw new Error();
      const data = await res.json();
      const resolvedAddress = data.display_name || "住所を取得できませんでした。";
      addressCache.set(r.number, resolvedAddress);
      if (addressText) addressText.textContent = resolvedAddress;
      const mobileAddressText = document.getElementById("mobileAddressText");
      if (mobileAddressText) mobileAddressText.textContent = resolvedAddress;
      updateMarkerPopup(r, resolvedAddress);
    } catch {
      const failedAddress = "住所を取得できませんでした。";
      if (addressText) addressText.textContent = failedAddress;
      const mobileAddressText = document.getElementById("mobileAddressText");
      if (mobileAddressText) mobileAddressText.textContent = failedAddress;
      updateMarkerPopup(r, failedAddress);
    }

  }

  function createMarker(r) {
    const marker = L.marker([r.lat, r.lng], {
      icon: iconFor(r),
      title: `番号 ${r.number}`
    }).addTo(markerGroup);

    marker.bindPopup(
      popupHtml(r, addressCache.get(r.number) || "住所を取得しています…"),
      {
        className: "point-popup",
        offset: [0, -4],
        autoPanPaddingTopLeft: [20, 20],
        autoPanPaddingBottomRight: [20, 20]
      }
    );

    marker.on("popupopen", () => {
      /* Re-check on every open (not just once at marker creation) so a
         resize/orientation change after load can't leave a stale popup
         bound on mobile. */
      if (isMobile()) {
        marker.closePopup();
        return;
      }
      // ハイライトの管理はselectRow()に一本化する（ここで個別に highlightedNumber を
      // 書き換えると、popupclose/popupopenの発火順序次第で直前に選んだピンが
      // 正しく拡大されないことがあったため）。
      selectRow(r, false);
    });

    marker.on("popupclose", () => {
      clearHighlightedMarker(r.number);
    });

    marker.on("click", () => {
      selectRow(r, false);
    });

    marker.on("dblclick", e => {
      L.DomEvent.stopPropagation(e);
      openStreetView(r);
    });

    markerMap.set(r.number, marker);
  }

  function createListRow(r) {
    const row = document.createElement("div");

    row.className = "point-row"
      + (r.userAdded ? " user-added" : "")
      + (isConfirmedShot(r) ? " shot" : "")
      + (isAutoShot(r) ? " unnecessary-row" : "")
      + (needsReshoot(r) ? " reshoot-row" : "")
      + (reshootResolved(r) ? " reshoot-done-row" : "");

    const no = document.createElement("span");
    no.className = "point-no";
    no.textContent = r.number;
    no.setAttribute("role","button");
    no.tabIndex = 0;

    const coord = document.createElement("span");
    coord.className = `point-coord ${statusClass(r)}`;
    coord.textContent = coordDisplay(r);
    coord.setAttribute("role","button");
    coord.tabIndex = 0;

    let flag = null;
    if (needsReshoot(r)) {
      flag = document.createElement("span");
      flag.className = "point-flag point-flag-reshoot";
      flag.textContent = "位置情報ズレ";
    } else if (reshootResolved(r)) {
      flag = document.createElement("span");
      flag.className = "point-flag point-flag-reshoot-done";
      flag.textContent = "再撮影済み";
    }

    const coordWrap = document.createElement("span");
    coordWrap.className = "point-coord-wrap";
    coordWrap.append(...[coord, flag].filter(Boolean));

    const open = async () => {
      await selectRow(r, true);

      /* Mobile only: list selection returns the user to the selected detail card. */
      if (isMobile()) {
        scrollToMobileMap();
      }
    };

    no.addEventListener("click", open);
    coord.addEventListener("click", open);

    no.addEventListener("keydown", e => {
      if (e.key === "Enter") open();
    });

    coord.addEventListener("keydown", e => {
      if (e.key === "Enter") open();
    });

    let tail;

    if (isAutoShot(r)) {
      tail = document.createElement("span");
      tail.className = "auto-shot-label";
      tail.textContent = "済";
    } else if (r.coordType !== "coordinate") {
      tail = document.createElement("span");
      tail.className = "auto-shot-label";
      tail.textContent = "座標待ち";
    } else {
      const checkLabel = document.createElement("label");
      checkLabel.className = "shoot-check";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = isShot(r);
      checkbox.setAttribute("aria-label", `番号 ${r.number} の撮影状態`);

      if (isMobile()) {
        checkbox.disabled = true;
        checkLabel.classList.add("readonly");
      } else {
        checkbox.addEventListener("change", e => setShot(r, e.target.checked));
      }

      const text = document.createElement("span");
      text.textContent = "撮影済";

      checkLabel.append(checkbox, text);
      tail = checkLabel;
    }

    if (isUserModified(r)) {
      const modTag = document.createElement("span");
      modTag.className = "point-flag point-flag-usermod";
      modTag.textContent = r.userAdded
        ? "追加した地点"
        : r.markedUnnecessary
        ? "不要に変更"
        : "座標を修正";
      coordWrap.appendChild(modTag);

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "row-delete-button";
      deleteBtn.textContent = "削除";
      deleteBtn.setAttribute("aria-label", `番号 ${r.number} の追加・更新座標を削除`);
      deleteBtn.addEventListener("click", e => {
        e.stopPropagation();
        removeUserModification(r);
      });
      tail.appendChild?.(deleteBtn) || row.appendChild(deleteBtn);
    }

    row.append(...[no, coordWrap, tail].filter(Boolean));
    if (isUserModified(r)) row.classList.add("has-delete");
    listEl.appendChild(row);
    rowMap.set(r.number, row);
  }

  function rebuildUI(preserveView = true) {
    let center = null;
    let zoom = null;

    if (preserveView && map) {
      center = map.getCenter();
      zoom = map.getZoom();
    }

    markerGroup.clearLayers();
    markerMap.clear();
    rowMap.clear();
    listEl.innerHTML = "";

    allRows.sort((a,b) => a.number - b.number).forEach(r => {
      if (r.coordType === "coordinate") createMarker(r);
      createListRow(r);
    });

    updateCount();
    applyShootFilter();

    if (center && zoom !== null) {
      map.setView(center, zoom);
    }
  }

  rebuildUI(false);

  if (markerGroup.getLayers().length) {
    map.fitBounds(markerGroup.getBounds().pad(0.04));
  }

  /* Layout (fonts, sidebar height) can still settle after the map's first
     paint. Re-sync Leaflet's cached container size once things settle, so
     popups/markers don't drift out of alignment on first interaction. */
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      map.invalidateSize();
    });
  });
  window.addEventListener("load", () => map.invalidateSize());

  function findRowByInput(inputEl) {
    const raw = inputEl.value.trim();
    if (!/^\d+$/.test(raw)) return;

    const n = Number(raw);
    const r = allRows.find(x => x.number === n);

    if (!r) {
      detailEl.innerHTML = `<div class="detail-empty">番号 ${n} は見つかりません。</div>`;
      return;
    }

    selectRow(r, true);
  }

  listSearchButton.addEventListener("click", () => findRowByInput(listSearchEl));

  listSearchEl.addEventListener("keydown", e => {
    if (e.key === "Enter") findRowByInput(listSearchEl);
  });

  fitButton.addEventListener("click", () => {
    if (markerGroup.getLayers().length) {
      map.fitBounds(markerGroup.getBounds().pad(0.04));
    }
  });

  function parseCoordinate(value) {
    const m = value.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (!m) return null;

    const lat = Number(m[1]);
    const lng = Number(m[2]);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

    return { lat, lng };
  }

  function showAddMessage(text, type = "") {
    if (!addMessage) return;

    addMessage.textContent = text;
    addMessage.className = "add-message" + (type ? ` ${type}` : "");
  }

  addPointButton?.addEventListener("click", () => {
    const numberText = addNumber.value.trim();
    const coordText = addCoordinate.value.trim();

    if (!/^\d+$/.test(numberText)) {
      showAddMessage("番号は整数で入力してください。", "error");
      return;
    }

    const number = Number(numberText);
    const parsed = parseCoordinate(coordText);

    if (!parsed) {
      showAddMessage("座標は「36.700000, 137.200000」の形式で入力してください。", "error");
      return;
    }

    const existing = allRows.find(r => r.number === number);

    if (existing) {
      if (existing.coordType === "unnecessary") {
        showAddMessage(`番号 ${number} は「不要」のため座標登録できません。`, "error");
        return;
      }

      if (existing.coordType === "coordinate") {
        showAddMessage(`番号 ${number} には既に座標があります。`, "error");
        return;
      }

      coordinateOverrides[String(number)] = {
        lat: parsed.lat,
        lng: parsed.lng
      };

      saveOverrides();

      allRows = buildRows();
      rebuildUI();

      addNumber.value = "";
      addCoordinate.value = "";

      showAddMessage(`番号 ${number} に座標を登録しました。`, "success");

      const updated = allRows.find(r => r.number === number);
      if (updated) {
        const marker = markerMap.get(number);
        if (marker) {
          map.setView(marker.getLatLng(), 17);
          marker.openPopup();
        }
        selectRow(updated, false);
      }

      return;
    }

    const newRow = {
      number,
      coordRaw: `${parsed.lat}, ${parsed.lng}`,
      coordType: "coordinate",
      lat: parsed.lat,
      lng: parsed.lng,
      userAdded: true
    };

    addedRows.push(newRow);
    saveAddedRows();

    allRows = buildRows();
    rebuildUI();

    addNumber.value = "";
    addCoordinate.value = "";

    showAddMessage(`番号 ${number} を追加しました。`, "success");

    const marker = markerMap.get(number);
    if (marker) {
      map.setView(marker.getLatLng(), 17);
      marker.openPopup();
    }

    selectRow(newRow, false);
  });

  [addNumber, addCoordinate].forEach(el => {
    el?.addEventListener("keydown", e => {
      if (e.key === "Enter") addPointButton.click();
    });
  });

  clearAddedButton?.addEventListener("click", () => {
    const overrideCount = Object.keys(coordinateOverrides).length;
    const addedCount = addedRows.length;
    const total = overrideCount + addedCount;

    if (!total) {
      showAddMessage("追加・更新した座標はありません。");
      return;
    }

    if (!confirm(`追加・更新した ${total} 件の座標をすべて元に戻しますか？`)) return;

    addedRows = [];
    coordinateOverrides = {};

    saveAddedRows();
    saveOverrides();

    allRows = buildRows();
    rebuildUI();

    showAddMessage("追加・更新した座標をすべて元に戻しました。", "success");

    if (markerGroup.getLayers().length) {
      map.fitBounds(markerGroup.getBounds().pad(0.04));
    }
  });

  toggleAddPoint?.addEventListener("click", () => {
    if (!addPointBody || !addPointSection) return;
    const opening = addPointBody.hasAttribute("hidden");

    if (opening) {
      addPointBody.removeAttribute("hidden");
      addPointSection.classList.remove("collapsed");
      toggleAddPoint.setAttribute("aria-expanded", "true");
    } else {
      addPointBody.setAttribute("hidden", "");
      addPointSection.classList.add("collapsed");
      toggleAddPoint.setAttribute("aria-expanded", "false");
    }
  });

  showAllShoot?.addEventListener("click", () => {
    shootFilter = "all";
    applyShootFilter();
  });

  showUnshot?.addEventListener("click", () => {
    shootFilter = "unshot";
    applyShootFilter();
  });

  showShot?.addEventListener("click", () => {
    shootFilter = "shot";
    applyShootFilter();
  });

  backToTop?.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  jumpToMapButton?.addEventListener("click", () => {
    scrollToMobileMap();
  });

  window.addEventListener("scroll", updateTopButtonVisibility, { passive: true });
  document.addEventListener("scroll", updateTopButtonVisibility, { passive: true, capture: true });
  updateTopButtonVisibility();

  window.addEventListener("resize", () => {
    setTimeout(() => map.invalidateSize(), 80);
    updateTopButtonVisibility();
  });
})();