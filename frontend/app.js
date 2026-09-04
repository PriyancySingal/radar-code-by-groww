(() => {
  const USER_ID = "demo-user";
  const API = "";

  const BAND_COLOR = {
    HIGH_ATTENTION: "var(--high)",
    IMPORTANT: "var(--important)",
    WORTH_WATCHING: "var(--watch)",
    NORMAL: "var(--normal)",
  };

  const BAND_LABEL = {
    HIGH_ATTENTION: "High attention",
    IMPORTANT: "Important",
    WORTH_WATCHING: "Worth watching",
    NORMAL: "Normal",
  };

  // symbol -> latest known public state
  const items = new Map();

  let currentView = "radar";
  let selectedSymbol = null;

  // ---------------- DOM refs ----------------

  const radarSvg = document.getElementById("radarSvg");
  const listBody = document.getElementById("watchTableBody");
  const watchChipList = document.getElementById("watchChipList");
  const symbolOptions = document.getElementById("symbolOptions");
  const shockSymbolSelect = document.getElementById("shockSymbol");
  const connStatus = document.getElementById("connStatus");

  // ---------------- API helpers ----------------

  async function api(path, opts) {
    const res = await fetch(API + path, opts);

    if (!res.ok) {
      throw new Error(`${path} -> ${res.status}`);
    }

    return res.json();
  }

  // ---------------- Stable radar angle per symbol ----------------

  function hashAngle(symbol) {
    let h = 0;

    for (let i = 0; i < symbol.length; i++) {
      h = (h * 31 + symbol.charCodeAt(i)) >>> 0;
    }

    return (h % 360) * (Math.PI / 180);
  }

  function radiusForScore(score) {
    // Higher score => closer to center.
    // Keep a minimum radius so nothing sits on top of the origin.

    const maxR = 250;
    const minR = 40;

    const t =
      Math.max(0, Math.min(100, score)) / 100;

    return maxR - t * (maxR - minR);
  }

  function radiusForBlip(score) {
    const minSize = 5;
    const maxSize = 15;

    return (
      minSize +
      (Math.max(0, Math.min(100, score)) / 100) *
        (maxSize - minSize)
    );
  }

  // ---------------- Rendering: Radar ----------------

  function buildRadarStatic() {
    const NS = "http://www.w3.org/2000/svg";

    radarSvg.innerHTML = "";

    const cx = 300;
    const cy = 300;

    // Rings
    [250, 187, 125, 62].forEach((r, i) => {
      const c = document.createElementNS(NS, "circle");

      c.setAttribute("cx", cx);
      c.setAttribute("cy", cy);
      c.setAttribute("r", r);
      c.setAttribute("fill", "none");
      c.setAttribute("stroke", "var(--grid)");
      c.setAttribute(
        "stroke-width",
        i === 0 ? 1.4 : 1
      );

      radarSvg.appendChild(c);
    });

    // Cross-hairs
    [
      [cx - 250, cy, cx + 250, cy],
      [cx, cy - 250, cx, cy + 250],
    ].forEach(([x1, y1, x2, y2]) => {
      const l = document.createElementNS(NS, "line");

      l.setAttribute("x1", x1);
      l.setAttribute("y1", y1);
      l.setAttribute("x2", x2);
      l.setAttribute("y2", y2);
      l.setAttribute(
        "stroke",
        "var(--grid-soft)"
      );
      l.setAttribute("stroke-width", 1);

      radarSvg.appendChild(l);
    });

    // Sweep wedge
    const sweepGroup =
      document.createElementNS(NS, "g");

    sweepGroup.setAttribute(
      "id",
      "sweepGroup"
    );

    const gradId = "sweepGrad";

    const defs =
      document.createElementNS(NS, "defs");

    const grad =
      document.createElementNS(
        NS,
        "linearGradient"
      );

    grad.setAttribute("id", gradId);
    grad.setAttribute("x1", "0%");
    grad.setAttribute("y1", "0%");
    grad.setAttribute("x2", "100%");
    grad.setAttribute("y2", "0%");

    const stop1 =
      document.createElementNS(NS, "stop");

    stop1.setAttribute("offset", "0%");
    stop1.setAttribute(
      "stop-color",
      "var(--sweep)"
    );
    stop1.setAttribute(
      "stop-opacity",
      "0"
    );

    const stop2 =
      document.createElementNS(NS, "stop");

    stop2.setAttribute("offset", "100%");
    stop2.setAttribute(
      "stop-color",
      "var(--sweep)"
    );
    stop2.setAttribute(
      "stop-opacity",
      "0.28"
    );

    grad.appendChild(stop1);
    grad.appendChild(stop2);

    defs.appendChild(grad);
    radarSvg.appendChild(defs);

    const wedge =
      document.createElementNS(NS, "path");

    const wedgeAngle =
      34 * (Math.PI / 180);

    const x2 =
      cx +
      250 *
        Math.cos(-Math.PI / 2);

    const y2 =
      cy +
      250 *
        Math.sin(-Math.PI / 2);

    const x3 =
      cx +
      250 *
        Math.cos(
          -Math.PI / 2 + wedgeAngle
        );

    const y3 =
      cy +
      250 *
        Math.sin(
          -Math.PI / 2 + wedgeAngle
        );

    wedge.setAttribute(
      "d",
      `M${cx},${cy} L${x2},${y2} A250,250 0 0,1 ${x3},${y3} Z`
    );

    wedge.setAttribute(
      "fill",
      `url(#${gradId})`
    );

    sweepGroup.appendChild(wedge);
    radarSvg.appendChild(sweepGroup);

    const blipLayer =
      document.createElementNS(NS, "g");

    blipLayer.setAttribute(
      "id",
      "blipLayer"
    );

    radarSvg.appendChild(blipLayer);
  }

  function renderRadar() {
    const NS = "http://www.w3.org/2000/svg";

    const layer =
      document.getElementById(
        "blipLayer"
      );

    if (!layer) return;

    layer.innerHTML = "";

    const cx = 300;
    const cy = 300;

    for (const st of items.values()) {
      const angle = hashAngle(st.symbol);

      const r =
        radiusForScore(st.score);

      const x =
        cx + r * Math.cos(angle);

      const y =
        cy + r * Math.sin(angle);

      const color =
        BAND_COLOR[st.band] ||
        BAND_COLOR.NORMAL;

      const g =
        document.createElementNS(
          NS,
          "g"
        );

      g.setAttribute(
        "class",
        "blip"
      );

      g.dataset.symbol =
        st.symbol;

      if (st.band !== "NORMAL") {
        const ring =
          document.createElementNS(
            NS,
            "circle"
          );

        ring.setAttribute(
          "class",
          "ring"
        );

        ring.setAttribute(
          "cx",
          x
        );

        ring.setAttribute(
          "cy",
          y
        );

        ring.setAttribute(
          "r",
          radiusForBlip(
            st.score
          ) + 6
        );

        ring.setAttribute(
          "stroke",
          color
        );

        ring.setAttribute(
          "stroke-width",
          1.5
        );

        g.appendChild(ring);
      }

      const core =
        document.createElementNS(
          NS,
          "circle"
        );

      core.setAttribute(
        "class",
        "core"
      );

      core.setAttribute(
        "cx",
        x
      );

      core.setAttribute(
        "cy",
        y
      );

      core.setAttribute(
        "r",
        radiusForBlip(
          st.score
        )
      );

      core.setAttribute(
        "fill",
        color
      );

      g.appendChild(core);

      const label =
        document.createElementNS(
          NS,
          "text"
        );

      label.setAttribute(
        "class",
        "blip-label"
      );

      label.setAttribute(
        "x",
        x
      );

      label.setAttribute(
        "y",
        y -
          radiusForBlip(
            st.score
          ) -
          6
      );

      label.setAttribute(
        "text-anchor",
        "middle"
      );

      label.textContent =
        st.symbol;

      g.appendChild(label);

      g.addEventListener(
        "click",
        () =>
          showExplain(
            st.symbol
          )
      );

      layer.appendChild(g);
    }
  }

  // ---------------- Rendering: List ----------------

  function renderList() {
    listBody.innerHTML = "";

    const sorted =
      [...items.values()].sort(
        (a, b) =>
          b.score - a.score
      );

    for (const st of sorted) {
      const tr =
        document.createElement(
          "tr"
        );

      tr.innerHTML = `
        <td style="font-family:var(--mono); font-weight:600;">
          ${st.symbol}
        </td>

        <td>
          ${st.sector}
        </td>

        <td class="num">
          ${st.price.toFixed(2)}
        </td>

        <td class="num">
          ${
            st.changePct !==
            undefined
              ? st.changePct.toFixed(
                  2
                ) + "%"
              : "&mdash;"
          }
        </td>

        <td class="num">
          ${st.score}
        </td>

        <td>
          <span class="status-pill pill-${st.band}">
            ${BAND_LABEL[st.band]}
          </span>
        </td>
      `;

      tr.addEventListener(
        "click",
        () =>
          showExplain(
            st.symbol
          )
      );

      listBody.appendChild(tr);
    }
  }

  // ---------------- Watchlist chips ----------------

  function renderChips() {
    watchChipList.innerHTML = "";

    for (const st of items.values()) {
      const li =
        document.createElement(
          "li"
        );

      li.className =
        "watch-chip";

      li.innerHTML = `
        ${st.symbol}
        <button
          class="remove-btn"
          title="Remove"
        >
          &times;
        </button>
      `;

      li.querySelector(
        ".remove-btn"
      ).addEventListener(
        "click",
        async (e) => {
          e.stopPropagation();

          await api(
            `/api/watchlist/${USER_ID}/${st.symbol}`,
            {
              method: "DELETE",
            }
          );

          items.delete(
            st.symbol
          );

          renderAll();
        }
      );

      watchChipList.appendChild(
        li
      );
    }
  }

  function renderAll() {
    if (currentView === "radar") {
      renderRadar();
    } else {
      renderList();
    }

    renderChips();
  }

  // ---------------- Price Sparkline ----------------

  function renderSparkline(history) {
    const svg =
      document.getElementById(
        "priceSparkline"
      );

    const rangeLabel =
      document.getElementById(
        "sparklineRange"
      );

    if (!svg) return;

    svg.innerHTML = "";

    if (
      !Array.isArray(history) ||
      history.length < 2
    ) {
      if (rangeLabel) {
        rangeLabel.textContent =
          "warming up";
      }

      return;
    }

    const values =
      history
        .map((point) => {
          if (
            typeof point ===
            "number"
          ) {
            return point;
          }

          return Number(
            point.price
          );
        })
        .filter(
          Number.isFinite
        );

    if (values.length < 2) {
      if (rangeLabel) {
        rangeLabel.textContent =
          "warming up";
      }

      return;
    }

    const width = 360;
    const height = 100;
    const padding = 8;

    const min =
      Math.min(...values);

    const max =
      Math.max(...values);

    const spread =
      max - min || 1;

    const points =
      values.map(
        (value, index) => {
          const x =
            padding +
            (index /
              (values.length -
                1)) *
              (width -
                padding * 2);

          const y =
            height -
            padding -
            ((value - min) /
              spread) *
              (height -
                padding * 2);

          return `${x.toFixed(
            1
          )},${y.toFixed(1)}`;
        }
      );

    // Line

    const line =
      document.createElementNS(
        "http://www.w3.org/2000/svg",
        "polyline"
      );

    line.setAttribute(
      "points",
      points.join(" ")
    );

    line.setAttribute(
      "fill",
      "none"
    );

    line.setAttribute(
      "stroke",
      "var(--sweep)"
    );

    line.setAttribute(
      "stroke-width",
      "2"
    );

    line.setAttribute(
      "stroke-linecap",
      "round"
    );

    line.setAttribute(
      "stroke-linejoin",
      "round"
    );

    svg.appendChild(line);

    // Current price marker

    const last =
      points[
        points.length - 1
      ].split(",");

    const marker =
      document.createElementNS(
        "http://www.w3.org/2000/svg",
        "circle"
      );

    marker.setAttribute(
      "cx",
      last[0]
    );

    marker.setAttribute(
      "cy",
      last[1]
    );

    marker.setAttribute(
      "r",
      "4"
    );

    marker.setAttribute(
      "fill",
      "var(--sweep)"
    );

    svg.appendChild(
      marker
    );

    // Current price text

    const lastValue =
      values[
        values.length - 1
      ];

    const priceLabel =
      document.createElementNS(
        "http://www.w3.org/2000/svg",
        "text"
      );

    priceLabel.setAttribute(
      "x",
      Number(last[0]) - 4
    );

    priceLabel.setAttribute(
      "y",
      Math.max(
        14,
        Number(last[1]) - 10
      )
    );

    priceLabel.setAttribute(
      "text-anchor",
      "end"
    );

    priceLabel.setAttribute(
      "fill",
      "var(--text)"
    );

    priceLabel.setAttribute(
      "font-size",
      "10"
    );

    priceLabel.setAttribute(
      "font-family",
      "var(--mono)"
    );

    priceLabel.textContent =
      lastValue.toFixed(2);

    svg.appendChild(
      priceLabel
    );

    if (rangeLabel) {
      rangeLabel.textContent =
        `${min.toFixed(
          0
        )} — ${max.toFixed(0)}`;
    }
  }

  // ---------------- Explainability panel ----------------

  async function showExplain(
    symbol
  ) {
    selectedSymbol =
      symbol;

    try {
      const data =
        await api(
          `/api/explain/${symbol}`
        );

      document
        .getElementById(
          "explainEmpty"
        )
        .classList.add(
          "hidden"
        );

      const content =
        document.getElementById(
          "explainContent"
        );

      content.classList.remove(
        "hidden"
      );

      document.getElementById(
        "explainSymbol"
      ).textContent =
        data.symbol;

      document.getElementById(
        "explainScore"
      ).textContent =
        data.score;

      document.getElementById(
        "explainBand"
      ).textContent =
        BAND_LABEL[
          data.band
        ] || data.band;

      // NEW:
      // Render recent price history
      // inside the explainability panel.
      renderSparkline(
        data.history
      );

      const evidenceList =
        document.getElementById(
          "explainEvidence"
        );

      evidenceList.innerHTML =
        "";

      if (
        !Array.isArray(
          data.evidence
        ) ||
        data.evidence.length ===
          0
      ) {
        const li =
          document.createElement(
            "li"
          );

        li.style.borderLeftColor =
          "var(--grid)";

        li.style.color =
          "var(--muted)";

        li.textContent =
          "Behaving normally — nothing in its current move is statistically unusual.";

        evidenceList.appendChild(
          li
        );
      } else {
        for (const ev of data.evidence) {
          const li =
            document.createElement(
              "li"
            );

          li.textContent =
            ev.text;

          evidenceList.appendChild(
            li
          );
        }
      }

      const comps =
        document.getElementById(
          "explainComponents"
        );

      comps.innerHTML = "";

      const labels = {
        priceComponent:
          "price",

        volumeComponent:
          "volume",

        divergenceComponent:
          "divergence",

        dormancyComponent:
          "dormancy",

        thresholdComponent:
          "threshold",
      };

      if (
        data.components
      ) {
        for (const [
          key,
          val,
        ] of Object.entries(
          data.components
        )) {
          const chip =
            document.createElement(
              "span"
            );

          chip.className =
            "comp-chip";

          chip.textContent =
            `${labels[key] || key} +${val}`;

          comps.appendChild(
            chip
          );
        }
      }
    } catch (error) {
      console.error(
        "Explain request failed:",
        error
      );
    }
  }

  // ---------------- Digest / calm state ----------------

  async function loadDigest() {
    const data =
      await api(
        `/api/digest/${USER_ID}`
      );

    const banner =
      document.getElementById(
        "digestBanner"
      );

    const calm =
      document.getElementById(
        "calmBanner"
      );

    if (data.count > 0) {
      document.getElementById(
        "digestCount"
      ).textContent =
        data.count;

      document.getElementById(
        "digestText"
      ).textContent =
        data.count === 1
          ? "stock moved outside its normal range while you were away"
          : "stocks moved outside their normal range while you were away";

      const list =
        document.getElementById(
          "digestList"
        );

      list.innerHTML = "";

      for (const ch of data.changes.slice(
        0,
        5
      )) {
        const div =
          document.createElement(
            "div"
          );

        div.className =
          "digest-item";

        div.innerHTML =
          `<strong>${ch.symbol}</strong> &mdash; ${ch.narrative}`;

        list.appendChild(
          div
        );
      }

      banner.classList.remove(
        "hidden"
      );

      calm.classList.add(
        "hidden"
      );
    } else {
      banner.classList.add(
        "hidden"
      );

      const count =
        items.size;

      document.getElementById(
        "calmText"
      ).textContent =
        `${count} stocks reviewed \u2014 nothing needs you right now.`;

      calm.classList.remove(
        "hidden"
      );
    }
  }

  document
    .getElementById(
      "digestDismiss"
    )
    .addEventListener(
      "click",
      async () => {
        await api(
          `/api/checkin/${USER_ID}`,
          {
            method: "POST",
          }
        );

        document
          .getElementById(
            "digestBanner"
          )
          .classList.add(
            "hidden"
          );

        loadDigest();
      }
    );

  // ---------------- Watchlist load / add ----------------

  async function loadWatchlist() {
    const data =
      await api(
        `/api/watchlist/${USER_ID}`
      );

    items.clear();

    for (const it of data.items) {
      items.set(
        it.symbol,
        it
      );
    }

    renderAll();
  }

  document
    .getElementById(
      "addSymbolBtn"
    )
    .addEventListener(
      "click",
      addSymbol
    );

  document
    .getElementById(
      "addSymbolInput"
    )
    .addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Enter") {
          addSymbol();
        }
      }
    );

  async function addSymbol() {
    const input =
      document.getElementById(
        "addSymbolInput"
      );

    const symbol =
      input.value
        .trim()
        .toUpperCase();

    if (!symbol) return;

    try {
      await api(
        `/api/watchlist/${USER_ID}`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            symbol,
          }),
        }
      );

      input.value = "";

      await loadWatchlist();
    } catch (e) {
      input.placeholder =
        "Unknown symbol — try again";
    }
  }

  // ---------------- View toggle ----------------

  document
    .querySelectorAll(
      ".toggle-btn"
    )
    .forEach((btn) => {
      btn.addEventListener(
        "click",
        () => {
          document
            .querySelectorAll(
              ".toggle-btn"
            )
            .forEach((b) =>
              b.classList.remove(
                "active"
              )
            );

          btn.classList.add(
            "active"
          );

          currentView =
            btn.dataset.view;

          document
            .getElementById(
              "radarView"
            )
            .classList.toggle(
              "hidden",
              currentView !==
                "radar"
            );

          document
            .getElementById(
              "listView"
            )
            .classList.toggle(
              "hidden",
              currentView !==
                "list"
            );

          renderAll();
        }
      );
    });

  // ---------------- Demo shock control ----------------

  document
    .getElementById(
      "shockBtn"
    )
    .addEventListener(
      "click",
      async () => {
        const symbol =
          shockSymbolSelect.value;

        const direction =
          document.getElementById(
            "shockDirection"
          ).value;

        if (!symbol) return;

        await api(
          "/api/simulate/shock",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify({
              symbol,
              direction,
              magnitude:
                0.055,

              volumeMultiplier:
                7,
            }),
          }
        );
      }
    );

  // ---------------- Symbol pickers ----------------

  async function populateSymbolPickers() {
    const data =
      await api(
        "/api/symbols"
      );

    symbolOptions.innerHTML =
      "";

    shockSymbolSelect.innerHTML =
      "";

    for (const s of data.symbols) {
      const opt1 =
        document.createElement(
          "option"
        );

      opt1.value =
        s.symbol;

      symbolOptions.appendChild(
        opt1
      );

      const opt2 =
        document.createElement(
          "option"
        );

      opt2.value =
        s.symbol;

      opt2.textContent =
        `${s.symbol} \u2014 ${s.name}`;

      shockSymbolSelect.appendChild(
        opt2
      );
    }
  }

  // ---------------- Live stream ----------------

  function connectStream() {
    const es =
      new EventSource(
        "/api/stream"
      );

    es.onopen = () => {
      connStatus.classList.add(
        "live"
      );

      connStatus.innerHTML =
        '<span class="dot"></span> live';
    };

    es.onerror = () => {
      connStatus.classList.remove(
        "live"
      );

      connStatus.innerHTML =
        '<span class="dot"></span> reconnecting&hellip;';
    };

    es.onmessage = (
      evt
    ) => {
      const payload =
        JSON.parse(
          evt.data
        );

      if (
        payload.type !==
        "TICK"
      ) {
        return;
      }

      let touchedWatchlist =
        false;

      for (const upd of payload.symbols) {
        if (
          items.has(
            upd.symbol
          )
        ) {
          items.set(
            upd.symbol,
            {
              ...items.get(
                upd.symbol
              ),

              ...upd,
            }
          );

          touchedWatchlist =
            true;
        }
      }

      if (
        touchedWatchlist
      ) {
        renderAll();

        if (
          selectedSymbol &&
          items.has(
            selectedSymbol
          )
        ) {
          // Keep explain panel
          // fresh if selected symbol
          // just ticked.
          showExplain(
            selectedSymbol
          );
        }
      }
    };
  }

  // ---------------- Boot ----------------

  (async function init() {
    buildRadarStatic();

    await populateSymbolPickers();

    await loadWatchlist();

    await loadDigest();

    connectStream();
  })();
})();