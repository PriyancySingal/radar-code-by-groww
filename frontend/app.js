(() => {

  const USER_ID = "demo-user";
  const API = "";


  /* ==========================================================
     BAND CONFIGURATION
  ========================================================== */

  /* ==========================================================
     RESOLVED COLORS

     WHY THIS EXISTS:
     SVG presentation attributes (fill="...", stroke="...") set
     via setAttribute() do NOT reliably resolve CSS custom
     properties (var(--x)) across browsers/engines. Some engines
     silently fail and fall back to the SVG initial value
     (fill defaults to black, stroke defaults to none), which is
     why rings/lines/some blips were invisible or rendered black.

     Fix: read each custom property's real value ONCE via
     getComputedStyle and use that literal value (e.g. "#36e6c1")
     everywhere we build raw SVG elements. CSS variables are still
     fine to use in normal HTML/CSS (style attributes, classes) —
     this only matters for SVG presentation attributes.
  ========================================================== */

  const rootStyles =
    getComputedStyle(document.documentElement);

  function cssVar(name, fallback) {

    const value =
      rootStyles.getPropertyValue(name).trim();

    return value || fallback;

  }

  const COLORS = {

    high: cssVar("--high", "#ff667b"),

    important: cssVar("--important", "#ffbc4f"),

    watch: cssVar("--watch", "#45d8cf"),

    normal: cssVar("--normal", "#6d7f9d"),

    grid: cssVar("--grid", "rgba(91, 126, 164, 0.42)"),

    gridSoft: cssVar("--grid-soft", "rgba(91, 126, 164, 0.20)"),

    sweep: cssVar("--sweep", "#36e6c1"),

    text: cssVar("--text", "#edf4ff"),

    muted: cssVar("--muted", "#718198"),

    mono: '"SFMono-Regular", Consolas, "Liberation Mono", monospace'

  };


  const BAND_COLOR = {

    HIGH_ATTENTION:
      COLORS.high,

    IMPORTANT:
      COLORS.important,

    WORTH_WATCHING:
      COLORS.watch,

    NORMAL:
      COLORS.normal

  };


  const BAND_LABEL = {

    HIGH_ATTENTION:
      "High attention",

    IMPORTANT:
      "Important",

    WORTH_WATCHING:
      "Worth watching",

    NORMAL:
      "Normal"

  };


  /* ==========================================================
     APPLICATION STATE
  ========================================================== */

  const items = new Map();

  let currentView = "radar";

  let selectedSymbol = null;

  let explainRequestInFlight = false;

  let explainRefreshPending = false;


  /* ==========================================================
     DOM REFERENCES
  ========================================================== */

  const radarSvg =
    document.getElementById("radarSvg");

  const listBody =
    document.getElementById("watchTableBody");

  const watchChipList =
    document.getElementById("watchChipList");

  const symbolOptions =
    document.getElementById("symbolOptions");

  const shockSymbolSelect =
    document.getElementById("shockSymbol");

  const connStatus =
    document.getElementById("connStatus");


  /* ==========================================================
     API
  ========================================================== */

  async function api(path, opts = {}) {

    const res =
      await fetch(
        API + path,
        opts
      );

    if (!res.ok) {

      throw new Error(
        `${path} -> ${res.status}`
      );

    }

    return res.json();
  }


  /* ==========================================================
     UTILITY
  ========================================================== */

  function safeNumber(
    value,
    fallback = 0
  ) {

    const n =
      Number(value);

    return Number.isFinite(n)
      ? n
      : fallback;
  }


  function formatPrice(value) {

    return safeNumber(value)
      .toFixed(2);

  }


  function formatPercent(
    value,
    digits = 2
  ) {

    const n =
      safeNumber(value);

    if (n > 0) {

      return `+${n.toFixed(digits)}%`;

    }

    return `${n.toFixed(digits)}%`;

  }


  function clamp(
    value,
    min,
    max
  ) {

    return Math.max(
      min,
      Math.min(max, value)
    );

  }


  /* ==========================================================
     STABLE RADAR ANGLE
  ========================================================== */

  function hashAngle(symbol) {

    let h = 0;

    for (
      let i = 0;
      i < symbol.length;
      i++
    ) {

      h =
        (
          h * 31 +
          symbol.charCodeAt(i)
        ) >>> 0;

    }

    return (
      (h % 360) *
      (Math.PI / 180)
    );

  }


  /* ==========================================================
     RADAR POSITION
  ========================================================== */

  function radiusForScore(score) {

    const maxR = 250;

    const minR = 40;

    const t =
      clamp(
        safeNumber(score),
        0,
        100
      ) / 100;

    return (
      maxR -
      t * (maxR - minR)
    );

  }


  function radiusForBlip(score) {

    const minSize = 5;

    const maxSize = 15;

    return (
      minSize +
      (
        clamp(
          safeNumber(score),
          0,
          100
        ) / 100
      ) *
      (maxSize - minSize)
    );

  }


  /* ==========================================================
     SVG HELPER
  ========================================================== */

  const SVG_NS =
    "http://www.w3.org/2000/svg";


  function svgElement(
    type
  ) {

    return document.createElementNS(
      SVG_NS,
      type
    );

  }


  /* ==========================================================
     BUILD RADAR
  ========================================================== */

  function buildRadarStatic() {

    if (!radarSvg) {
      return;
    }

    radarSvg.innerHTML = "";

    const cx = 300;

    const cy = 300;


    /* --------------------------------------------------------
       DEFS
    -------------------------------------------------------- */

    const defs =
      svgElement("defs");


    /* Radar glow */

    const radial =
      svgElement(
        "radialGradient"
      );

    radial.setAttribute(
      "id",
      "radarGlow"
    );

    radial.setAttribute(
      "cx",
      "50%"
    );

    radial.setAttribute(
      "cy",
      "50%"
    );

    radial.setAttribute(
      "r",
      "50%"
    );


    const rg1 =
      svgElement("stop");

    rg1.setAttribute(
      "offset",
      "0%"
    );

    rg1.setAttribute(
      "stop-color",
      "#35e6c1"
    );

    rg1.setAttribute(
      "stop-opacity",
      "0.10"
    );


    const rg2 =
      svgElement("stop");

    rg2.setAttribute(
      "offset",
      "65%"
    );

    rg2.setAttribute(
      "stop-color",
      "#35e6c1"
    );

    rg2.setAttribute(
      "stop-opacity",
      "0.015"
    );


    const rg3 =
      svgElement("stop");

    rg3.setAttribute(
      "offset",
      "100%"
    );

    rg3.setAttribute(
      "stop-color",
      "#35e6c1"
    );

    rg3.setAttribute(
      "stop-opacity",
      "0"
    );


    radial.appendChild(rg1);
    radial.appendChild(rg2);
    radial.appendChild(rg3);

    defs.appendChild(radial);


    /* Sweep gradient */

    const grad =
      svgElement(
        "linearGradient"
      );

    grad.setAttribute(
      "id",
      "sweepGrad"
    );

    grad.setAttribute(
      "x1",
      "0%"
    );

    grad.setAttribute(
      "y1",
      "0%"
    );

    grad.setAttribute(
      "x2",
      "100%"
    );

    grad.setAttribute(
      "y2",
      "0%"
    );


    const stop1 =
      svgElement("stop");

    stop1.setAttribute(
      "offset",
      "0%"
    );

    stop1.setAttribute(
      "stop-color",
      COLORS.sweep
    );

    stop1.setAttribute(
      "stop-opacity",
      "0"
    );


    const stop2 =
      svgElement("stop");

    stop2.setAttribute(
      "offset",
      "100%"
    );

    stop2.setAttribute(
      "stop-color",
      COLORS.sweep
    );

    stop2.setAttribute(
      "stop-opacity",
      "0.24"
    );


    grad.appendChild(stop1);
    grad.appendChild(stop2);

    defs.appendChild(grad);


    radarSvg.appendChild(defs);


    /* --------------------------------------------------------
       CENTER GLOW
    -------------------------------------------------------- */

    const glow =
      svgElement("circle");

    glow.setAttribute(
      "cx",
      cx
    );

    glow.setAttribute(
      "cy",
      cy
    );

    glow.setAttribute(
      "r",
      "250"
    );

    glow.setAttribute(
      "fill",
      "url(#radarGlow)"
    );

    radarSvg.appendChild(glow);


    /* --------------------------------------------------------
       RADAR RINGS
    -------------------------------------------------------- */

    const rings = [
      250,
      187,
      125,
      62
    ];


    rings.forEach(
      (r, i) => {

        const circle =
          svgElement("circle");

        circle.setAttribute(
          "cx",
          cx
        );

        circle.setAttribute(
          "cy",
          cy
        );

        circle.setAttribute(
          "r",
          r
        );

        circle.setAttribute(
          "fill",
          "none"
        );

        circle.setAttribute(
          "stroke",
          COLORS.grid
        );

        circle.setAttribute(
          "stroke-width",
          i === 0
            ? "1.4"
            : "1"
        );

        radarSvg.appendChild(
          circle
        );

      }
    );


    /* --------------------------------------------------------
       CROSSHAIRS
    -------------------------------------------------------- */

    const crosshairLines = [

      [
        cx - 250,
        cy,
        cx + 250,
        cy
      ],

      [
        cx,
        cy - 250,
        cx,
        cy + 250
      ]

    ];


    crosshairLines.forEach(
      ([x1, y1, x2, y2]) => {

        const line =
          svgElement("line");

        line.setAttribute(
          "x1",
          x1
        );

        line.setAttribute(
          "y1",
          y1
        );

        line.setAttribute(
          "x2",
          x2
        );

        line.setAttribute(
          "y2",
          y2
        );

        line.setAttribute(
          "stroke",
          COLORS.gridSoft
        );

        line.setAttribute(
          "stroke-width",
          "1"
        );

        radarSvg.appendChild(
          line
        );

      }
    );


    /* --------------------------------------------------------
       CENTER POINT
    -------------------------------------------------------- */

    const centerOuter =
      svgElement("circle");

    centerOuter.setAttribute(
      "cx",
      cx
    );

    centerOuter.setAttribute(
      "cy",
      cy
    );

    centerOuter.setAttribute(
      "r",
      "5"
    );

    centerOuter.setAttribute(
      "fill",
      "none"
    );

    centerOuter.setAttribute(
      "stroke",
      COLORS.sweep
    );

    centerOuter.setAttribute(
      "stroke-width",
      "1"
    );

    centerOuter.setAttribute(
      "opacity",
      "0.65"
    );

    radarSvg.appendChild(
      centerOuter
    );


    const center =
      svgElement("circle");

    center.setAttribute(
      "cx",
      cx
    );

    center.setAttribute(
      "cy",
      cy
    );

    center.setAttribute(
      "r",
      "2"
    );

    center.setAttribute(
      "fill",
      COLORS.sweep
    );

    radarSvg.appendChild(
      center
    );


    /* --------------------------------------------------------
       SWEEP WEDGE
    -------------------------------------------------------- */

    const sweepGroup =
      svgElement("g");

    sweepGroup.setAttribute(
      "id",
      "sweepGroup"
    );


    const wedge =
      svgElement("path");


    const wedgeAngle =
      34 *
      (Math.PI / 180);


    const startAngle =
      -Math.PI / 2;


    const x2 =
      cx +
      250 *
      Math.cos(
        startAngle
      );


    const y2 =
      cy +
      250 *
      Math.sin(
        startAngle
      );


    const x3 =
      cx +
      250 *
      Math.cos(
        startAngle +
        wedgeAngle
      );


    const y3 =
      cy +
      250 *
      Math.sin(
        startAngle +
        wedgeAngle
      );


    wedge.setAttribute(
      "d",
      `M${cx},${cy}
       L${x2},${y2}
       A250,250 0 0,1 ${x3},${y3}
       Z`
    );


    wedge.setAttribute(
      "fill",
      "url(#sweepGrad)"
    );


    sweepGroup.appendChild(
      wedge
    );


    radarSvg.appendChild(
      sweepGroup
    );


    /* --------------------------------------------------------
       BLIP LAYER
    -------------------------------------------------------- */

    const blipLayer =
      svgElement("g");

    blipLayer.setAttribute(
      "id",
      "blipLayer"
    );

    radarSvg.appendChild(
      blipLayer
    );

  }


  /* ==========================================================
     RADAR RENDER
  ========================================================== */

  function renderRadar() {

    const layer =
      document.getElementById(
        "blipLayer"
      );

    if (!layer) {
      return;
    }

    layer.innerHTML = "";


    const cx = 300;

    const cy = 300;


    for (
      const st of items.values()
    ) {

      const score =
        safeNumber(
          st.score
        );


      const angle =
        hashAngle(
          st.symbol
        );


      const r =
        radiusForScore(
          score
        );


      const x =
        cx +
        r *
        Math.cos(angle);


      const y =
        cy +
        r *
        Math.sin(angle);


      const color =
        BAND_COLOR[
          st.band
        ] ||
        BAND_COLOR.NORMAL;


      const g =
        svgElement("g");


      g.setAttribute(
        "class",
        "blip"
      );


      g.dataset.symbol =
        st.symbol;


      const blipRadius =
        radiusForBlip(
          score
        );


      /* ------------------------------------------------------
         OUTER ATTENTION RING
      ------------------------------------------------------ */

      if (
        st.band !== "NORMAL"
      ) {

        const ring =
          svgElement(
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
          blipRadius + 7
        );


        ring.setAttribute(
          "stroke",
          color
        );


        ring.setAttribute(
          "stroke-width",
          "1.5"
        );


        g.appendChild(
          ring
        );

      }


      /* ------------------------------------------------------
         CORE
      ------------------------------------------------------ */

      const core =
        svgElement(
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
        blipRadius
      );


      core.setAttribute(
        "fill",
        color
      );


      g.appendChild(
        core
      );


      /* ------------------------------------------------------
         LABEL
      ------------------------------------------------------ */

      const label =
        svgElement(
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
        blipRadius -
        7
      );


      label.setAttribute(
        "text-anchor",
        "middle"
      );


      label.textContent =
        st.symbol;


      g.appendChild(
        label
      );


      /* ------------------------------------------------------
         CLICK
      ------------------------------------------------------ */

      g.addEventListener(
        "click",
        () => {

          showExplain(
            st.symbol
          );

        }
      );


      layer.appendChild(
        g
      );

    }

  }


  /* ==========================================================
     LIST
  ========================================================== */

  function renderList() {

    if (!listBody) {
      return;
    }

    listBody.innerHTML = "";


    const sorted =
      [
        ...items.values()
      ].sort(
        (a, b) =>
          safeNumber(b.score) -
          safeNumber(a.score)
      );


    for (
      const st of sorted
    ) {

      const tr =
        document.createElement(
          "tr"
        );


      const change =
        st.changePct !== undefined
          ? formatPercent(
              st.changePct
            )
          : "—";


      tr.innerHTML = `

        <td
          style="
            font-family:var(--mono);
            font-weight:600;
          "
        >
          ${st.symbol}
        </td>

        <td>
          ${st.sector || "—"}
        </td>

        <td class="num">
          ${formatPrice(st.price)}
        </td>

        <td class="num">
          ${change}
        </td>

        <td class="num">
          ${safeNumber(st.score)}
        </td>

        <td>

          <span
            class="status-pill pill-${st.band}"
          >

            ${
              BAND_LABEL[st.band]
              ||
              st.band
              ||
              "Normal"
            }

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


      listBody.appendChild(
        tr
      );

    }

  }


  /* ==========================================================
     WATCHLIST CHIPS
  ========================================================== */

  function renderChips() {

    if (!watchChipList) {
      return;
    }

    watchChipList.innerHTML = "";


    for (
      const st of items.values()
    ) {

      const li =
        document.createElement(
          "li"
        );


      li.className =
        "watch-chip";


      li.innerHTML = `

        <span>
          ${st.symbol}
        </span>

        <button
          class="remove-btn"
          title="Remove"
          type="button"
        >
          ×
        </button>

      `;


      const removeButton =
        li.querySelector(
          ".remove-btn"
        );


      removeButton.addEventListener(
        "click",
        async (e) => {

          e.stopPropagation();


          try {

            await api(
              `/api/watchlist/${encodeURIComponent(
                USER_ID
              )}/${encodeURIComponent(
                st.symbol
              )}`,
              {
                method:
                  "DELETE"
              }
            );


            items.delete(
              st.symbol
            );


            if (
              selectedSymbol ===
              st.symbol
            ) {

              selectedSymbol =
                null;


              const empty =
                document.getElementById(
                  "explainEmpty"
                );


              const content =
                document.getElementById(
                  "explainContent"
                );


              if (empty) {

                empty.classList.remove(
                  "hidden"
                );

              }


              if (content) {

                content.classList.add(
                  "hidden"
                );

              }

            }


            renderAll();


          } catch (error) {

            console.error(
              "Remove failed:",
              error
            );

          }

        }
      );


      watchChipList.appendChild(
        li
      );

    }

  }


  /* ==========================================================
     RENDER EVERYTHING
  ========================================================== */

  function renderAll() {

    if (
      currentView === "radar"
    ) {

      renderRadar();

    } else {

      renderList();

    }


    renderChips();

  }


  /* ==========================================================
     PRICE SPARKLINE
  ========================================================== */

  function renderSparkline(
    history
  ) {

    const svg =
      document.getElementById(
        "priceSparkline"
      );


    const rangeLabel =
      document.getElementById(
        "sparklineRange"
      );


    if (!svg) {
      return;
    }


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
        .map(
          point => {

            if (
              typeof point ===
              "number"
            ) {

              return point;

            }

            return Number(
              point?.price
            );

          }
        )
        .filter(
          Number.isFinite
        );


    if (
      values.length < 2
    ) {

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
      Math.min(
        ...values
      );


    const max =
      Math.max(
        ...values
      );


    const spread =
      max - min || 1;


    const points =
      values.map(
        (
          value,
          index
        ) => {

          const x =
            padding +
            (
              index /
              (values.length - 1)
            ) *
            (
              width -
              padding * 2
            );


          const y =
            height -
            padding -
            (
              (value - min) /
              spread
            ) *
            (
              height -
              padding * 2
            );


          return (
            `${x.toFixed(1)},${y.toFixed(1)}`
          );

        }
      );


    /* --------------------------------------------------------
       AREA FILL
    -------------------------------------------------------- */

    const area =
      svgElement(
        "polygon"
      );


    const areaPoints =
      [
        `${padding},${height - padding}`,

        ...points,

        `${width - padding},${height - padding}`
      ];


    area.setAttribute(
      "points",
      areaPoints.join(" ")
    );


    area.setAttribute(
      "fill",
      "rgba(53,230,193,0.055)"
    );


    svg.appendChild(
      area
    );


    /* --------------------------------------------------------
       LINE
    -------------------------------------------------------- */

    const line =
      svgElement(
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
      COLORS.sweep
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


    svg.appendChild(
      line
    );


    /* --------------------------------------------------------
       CURRENT PRICE MARKER
    -------------------------------------------------------- */

    const last =
      points[
        points.length - 1
      ].split(",");


    const marker =
      svgElement(
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
      COLORS.sweep
    );


    marker.setAttribute(
      "stroke",
      "#06120f"
    );


    marker.setAttribute(
      "stroke-width",
      "2"
    );


    svg.appendChild(
      marker
    );


    /* --------------------------------------------------------
       CURRENT PRICE TEXT
    -------------------------------------------------------- */

    const lastValue =
      values[
        values.length - 1
      ];


    const priceLabel =
      svgElement(
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
      COLORS.text
    );


    priceLabel.setAttribute(
      "font-size",
      "10"
    );


    priceLabel.setAttribute(
      "font-family",
      COLORS.mono
    );


    priceLabel.setAttribute(
      "font-weight",
      "700"
    );


    priceLabel.textContent =
      lastValue.toFixed(2);


    svg.appendChild(
      priceLabel
    );


    if (rangeLabel) {

      rangeLabel.textContent =
        `${min.toFixed(0)} — ${max.toFixed(0)}`;

    }

  }


  /* ==========================================================
     EXPLAINABILITY
  ========================================================== */

  async function showExplain(
    symbol
  ) {

    selectedSymbol =
      symbol;


    if (
      explainRequestInFlight
    ) {

      explainRefreshPending =
        true;

      return;

    }


    explainRequestInFlight =
      true;


    try {

      const data =
        await api(
          `/api/explain/${encodeURIComponent(
            symbol
          )}`
        );


      if (
        selectedSymbol !==
        symbol
      ) {

        return;

      }


      const empty =
        document.getElementById(
          "explainEmpty"
        );


      const content =
        document.getElementById(
          "explainContent"
        );


      if (empty) {

        empty.classList.add(
          "hidden"
        );

      }


      if (content) {

        content.classList.remove(
          "hidden"
        );

      }


      const explainSymbol =
        document.getElementById(
          "explainSymbol"
        );


      const explainScore =
        document.getElementById(
          "explainScore"
        );


      const explainBand =
        document.getElementById(
          "explainBand"
        );


      if (explainSymbol) {

        explainSymbol.textContent =
          data.symbol;

      }


      if (explainScore) {

        explainScore.textContent =
          safeNumber(
            data.score
          );

      }


      if (explainBand) {

        explainBand.textContent =
          BAND_LABEL[
            data.band
          ]
          ||
          data.band
          ||
          "Normal";

      }


      renderSparkline(
        data.history
      );


      /* --------------------------------------------------------
         EVIDENCE
      -------------------------------------------------------- */

      const evidenceList =
        document.getElementById(
          "explainEvidence"
        );


      if (evidenceList) {

        evidenceList.innerHTML =
          "";


        if (
          !Array.isArray(
            data.evidence
          )
          ||
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

          for (
            const ev of data.evidence
          ) {

            const li =
              document.createElement(
                "li"
              );


            li.textContent =
              typeof ev ===
              "string"
                ? ev
                : ev?.text ||
                  "Unusual market behavior detected.";


            evidenceList.appendChild(
              li
            );

          }

        }

      }


      /* --------------------------------------------------------
         COMPONENTS
      -------------------------------------------------------- */

      const comps =
        document.getElementById(
          "explainComponents"
        );


      if (comps) {

        comps.innerHTML =
          "";


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
            "threshold"

        };


        if (
          data.components
        ) {

          for (
            const [
              key,
              val
            ]
            of Object.entries(
              data.components
            )
          ) {

            const chip =
              document.createElement(
                "span"
              );


            chip.className =
              "comp-chip";


            const numericValue =
              safeNumber(
                val
              );


            chip.textContent =
              `${
                labels[key] ||
                key
              } +${numericValue}`;


            comps.appendChild(
              chip
            );

          }

        }

      }


    } catch (error) {

      console.error(
        "Explain request failed:",
        error
      );


    } finally {

      explainRequestInFlight =
        false;


      if (
        explainRefreshPending
      ) {

        explainRefreshPending =
          false;


        if (
          selectedSymbol
        ) {

          showExplain(
            selectedSymbol
          );

        }

      }

    }

  }


  /* ==========================================================
     DIGEST
  ========================================================== */

  async function loadDigest() {

    try {

      const data =
        await api(
          `/api/digest/${encodeURIComponent(
            USER_ID
          )}`
        );


      const banner =
        document.getElementById(
          "digestBanner"
        );


      const calm =
        document.getElementById(
          "calmBanner"
        );


      if (
        !banner ||
        !calm
      ) {

        return;

      }


      if (
        data.count > 0
      ) {

        const digestCount =
          document.getElementById(
            "digestCount"
          );


        const digestText =
          document.getElementById(
            "digestText"
          );


        const list =
          document.getElementById(
            "digestList"
          );


        if (digestCount) {

          digestCount.textContent =
            data.count;

        }


        if (digestText) {

          digestText.textContent =
            data.count === 1
              ? "stock moved outside its normal range while you were away"
              : "stocks moved outside their normal range while you were away";

        }


        if (list) {

          list.innerHTML =
            "";


          for (
            const ch of (
              data.changes || []
            ).slice(0, 5)
          ) {

            const div =
              document.createElement(
                "div"
              );


            div.className =
              "digest-item";


            const strong =
              document.createElement(
                "strong"
              );


            strong.textContent =
              ch.symbol;


            div.appendChild(
              strong
            );


            div.appendChild(
              document.createTextNode(
                ` — ${
                  ch.narrative ||
                  "Meaningful market behavior changed."
                }`
              )
            );


            list.appendChild(
              div
            );

          }

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


        const calmText =
          document.getElementById(
            "calmText"
          );


        if (calmText) {

          calmText.textContent =
            `${count} stocks reviewed — nothing needs you right now.`;

        }


        calm.classList.remove(
          "hidden"
        );

      }


    } catch (error) {

      console.error(
        "Digest request failed:",
        error
      );

    }

  }


  /* ==========================================================
     DISMISS DIGEST
  ========================================================== */

  const digestDismiss =
    document.getElementById(
      "digestDismiss"
    );


  if (digestDismiss) {

    digestDismiss.addEventListener(
      "click",
      async () => {

        try {

          await api(
            `/api/checkin/${encodeURIComponent(
              USER_ID
            )}`,
            {
              method:
                "POST"
            }
          );


          const banner =
            document.getElementById(
              "digestBanner"
            );


          if (banner) {

            banner.classList.add(
              "hidden"
            );

          }


          await loadDigest();


        } catch (error) {

          console.error(
            "Check-in failed:",
            error
          );

        }

      }
    );

  }


  /* ==========================================================
     LOAD WATCHLIST
  ========================================================== */

  async function loadWatchlist() {

    const data =
      await api(
        `/api/watchlist/${encodeURIComponent(
          USER_ID
        )}`
      );


    items.clear();


    for (
      const it of (
        data.items || []
      )
    ) {

      items.set(
        it.symbol,
        it
      );

    }


    renderAll();

  }


  /* ==========================================================
     ADD SYMBOL
  ========================================================== */

  const addSymbolBtn =
    document.getElementById(
      "addSymbolBtn"
    );


  if (addSymbolBtn) {

    addSymbolBtn.addEventListener(
      "click",
      addSymbol
    );

  }


  const addSymbolInput =
    document.getElementById(
      "addSymbolInput"
    );


  if (addSymbolInput) {

    addSymbolInput.addEventListener(
      "keydown",
      e => {

        if (
          e.key ===
          "Enter"
        ) {

          addSymbol();

        }

      }
    );

  }


  async function addSymbol() {

    const input =
      document.getElementById(
        "addSymbolInput"
      );


    if (!input) {
      return;
    }


    const symbol =
      input.value
        .trim()
        .toUpperCase();


    if (!symbol) {
      return;
    }


    try {

      await api(
        `/api/watchlist/${encodeURIComponent(
          USER_ID
        )}`,
        {

          method:
            "POST",

          headers: {

            "Content-Type":
              "application/json"

          },

          body:
            JSON.stringify({
              symbol
            })

        }
      );


      input.value =
        "";


      input.placeholder =
        "Add symbol...";


      await loadWatchlist();


    } catch (error) {

      console.error(
        "Add symbol failed:",
        error
      );


      input.value =
        "";


      input.placeholder =
        "Unknown symbol — try again";

    }

  }


  /* ==========================================================
     VIEW TOGGLE
  ========================================================== */

  document
    .querySelectorAll(
      ".toggle-btn"
    )
    .forEach(
      btn => {

        btn.addEventListener(
          "click",
          () => {

            document
              .querySelectorAll(
                ".toggle-btn"
              )
              .forEach(
                b =>
                  b.classList.remove(
                    "active"
                  )
              );


            btn.classList.add(
              "active"
            );


            currentView =
              btn.dataset.view;


            const radarView =
              document.getElementById(
                "radarView"
              );


            const listView =
              document.getElementById(
                "listView"
              );


            if (radarView) {

              radarView.classList.toggle(
                "hidden",
                currentView !==
                  "radar"
              );

            }


            if (listView) {

              listView.classList.toggle(
                "hidden",
                currentView !==
                  "list"
              );

            }


            renderAll();

          }
        );

      }
    );


  /* ==========================================================
     SHOCK CONTROL
  ========================================================== */

  const shockBtn =
    document.getElementById(
      "shockBtn"
    );


  if (shockBtn) {

    shockBtn.addEventListener(
      "click",
      async () => {

        const symbol =
          shockSymbolSelect?.value;


        const direction =
          document.getElementById(
            "shockDirection"
          )?.value;


        if (!symbol) {
          return;
        }


        try {

          await api(
            "/api/simulate/shock",
            {

              method:
                "POST",

              headers: {

                "Content-Type":
                  "application/json"

              },

              body:
                JSON.stringify({

                  symbol,

                  direction,

                  magnitude:
                    0.055,

                  volumeMultiplier:
                    7

                })

            }
          );


        } catch (error) {

          console.error(
            "Shock request failed:",
            error
          );

        }

      }
    );

  }


  /* ==========================================================
     SYMBOL PICKERS
  ========================================================== */

  async function populateSymbolPickers() {

    const data =
      await api(
        "/api/symbols"
      );


    if (symbolOptions) {

      symbolOptions.innerHTML =
        "";

    }


    if (shockSymbolSelect) {

      shockSymbolSelect.innerHTML =
        "";

    }


    for (
      const s of (
        data.symbols || []
      )
    ) {

      if (symbolOptions) {

        const opt1 =
          document.createElement(
            "option"
          );


        opt1.value =
          s.symbol;


        symbolOptions.appendChild(
          opt1
        );

      }


      if (shockSymbolSelect) {

        const opt2 =
          document.createElement(
            "option"
          );


        opt2.value =
          s.symbol;


        opt2.textContent =
          `${s.symbol} — ${s.name}`;


        shockSymbolSelect.appendChild(
          opt2
        );

      }

    }

  }


  /* ==========================================================
     LIVE STREAM
  ========================================================== */

  function connectStream() {

    const es =
      new EventSource(
        "/api/stream"
      );


    es.onopen = () => {

      if (!connStatus) {
        return;
      }


      connStatus.classList.add(
        "live"
      );


      connStatus.innerHTML =
        '<span class="dot"></span> live';

    };


    es.onerror = () => {

      if (!connStatus) {
        return;
      }


      connStatus.classList.remove(
        "live"
      );


      connStatus.innerHTML =
        '<span class="dot"></span> reconnecting…';

    };


    es.onmessage = evt => {

      try {

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


        for (
          const upd of (
            payload.symbols ||
            []
          )
        ) {

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
                ...upd
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

            showExplain(
              selectedSymbol
            );

          }

        }


      } catch (error) {

        console.error(
          "Stream message error:",
          error
        );

      }

    };


    return es;

  }


  /* ==========================================================
     INITIALIZATION
  ========================================================== */

  (async function init() {

    try {

      buildRadarStatic();


      await populateSymbolPickers();


      await loadWatchlist();


      await loadDigest();


      connectStream();


    } catch (error) {

      console.error(
        "RADAR initialization failed:",
        error
      );


      if (connStatus) {

        connStatus.classList.remove(
          "live"
        );


        connStatus.innerHTML =
          '<span class="dot"></span> backend unavailable';

      }

    }

  })();

})();