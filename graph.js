/* ═══════════════════════════════════════════════
   DATA — loaded from graph.json
   ═══════════════════════════════════════════════ */

let ALL_NODES = [];
let ALL_EDGES = [];
let NODES = [];
let EDGES = [];
let activeTag = "*";

/* ═══════════════════════════════════════════════
   STYLE MAP
   ═══════════════════════════════════════════════ */

const NODE_STYLES = {
  source:       { fill: "#161d2e", stroke: "#26c6da", dot: "#26c6da", typeColor: "#26c6da", typeLabel: "source"       },
  staging:      { fill: "#161d2e", stroke: "#4f7fff", dot: "#4f7fff", typeColor: "#4f7fff", typeLabel: "staging"      },
  intermediate: { fill: "#161d2e", stroke: "#7c5fff", dot: "#7c5fff", typeColor: "#7c5fff", typeLabel: "intermediate" },
  mart:         { fill: "#161d2e", stroke: "#3dd68c", dot: "#3dd68c", typeColor: "#3dd68c", typeLabel: "mart"         },
  report:       { fill: "#161d2e", stroke: "#f5a623", dot: "#f5a623", typeColor: "#f5a623", typeLabel: "report"       },
};

const LAYER_NAMES = { source: "Sources", staging: "Staging", intermediate: "Intermediate", mart: "Mart", report: "Reports" };

/* ═══════════════════════════════════════════════
   LAYOUT ENGINE — Sugiyama-inspired layer graph
   ═══════════════════════════════════════════════ */

const NODE_W = 168;
const NODE_H = 56;
const H_GAP  = 90;
const V_GAP  = 32;

function computeLayout(nodes, edges) {
  const layerOrder = ["source", "staging", "intermediate", "mart", "report"];
  const byLayer = {};
  layerOrder.forEach(l => byLayer[l] = []);
  nodes.forEach(n => byLayer[n.type].push(n));

  let xCursor = 60;
  const layerX = {};
  layerOrder.forEach(layer => {
    layerX[layer] = xCursor;
    const count = byLayer[layer].length;
    if (count > 0) xCursor += NODE_W + H_GAP;
  });

  nodes.forEach(n => {
    const layerNodes = byLayer[n.type];
    const idx = layerNodes.indexOf(n);
    const total = layerNodes.length;
    const totalH = total * NODE_H + (total - 1) * V_GAP;
    const startY = -totalH / 2;
    n.x = layerX[n.type];
    n.y = startY + idx * (NODE_H + V_GAP);
  });

  /* nudge y-positions to reduce edge crossings (barycenter heuristic) */
  for (let pass = 0; pass < 4; pass++) {
    layerOrder.forEach((layer, li) => {
      if (li === 0) return;
      const prevLayer = layerOrder[li - 1];
      const map = {};
      nodes.forEach(n => { map[n.id] = n; });

      byLayer[layer].forEach(n => {
        const incoming = edges.filter(e => e.to === n.id && map[e.from] && map[e.from].type === prevLayer);
        if (incoming.length === 0) return;
        const avgY = incoming.reduce((s, e) => s + map[e.from].y + NODE_H / 2, 0) / incoming.length;
        n._targetY = avgY - NODE_H / 2;
      });

      byLayer[layer].forEach(n => {
        if (n._targetY !== undefined) { n.y = n.y * 0.4 + n._targetY * 0.6; delete n._targetY; }
      });

      /* sort by y, then re-space evenly */
      byLayer[layer].sort((a, b) => a.y - b.y);
      const total = byLayer[layer].length;
      const totalH = total * NODE_H + (total - 1) * V_GAP;
      const startY = -totalH / 2;
      byLayer[layer].forEach((n, i) => { n.y = startY + i * (NODE_H + V_GAP); });
    });
  }
  return { layerX, layerOrder, byLayer };
}

/* ═══════════════════════════════════════════════
   SVG RENDERING
   ═══════════════════════════════════════════════ */

const svg    = document.getElementById("graph");
const scene  = document.getElementById("scene");
const tip    = document.getElementById("tooltip");

let transform = { x: 0, y: 0, scale: 1 };
let selectedId = null;
let svgW = 0, svgH = 0;

function updateTransform() {
  scene.setAttribute("transform",
    `translate(${transform.x}, ${transform.y}) scale(${transform.scale})`);
}

function resetView() {
  const svgRect = svg.getBoundingClientRect();
  svgW = svgRect.width; svgH = svgRect.height;
  /* center bounding box */
  const xs = NODES.map(n => n.x); const ys = NODES.map(n => n.y);
  const minX = Math.min(...xs); const maxX = Math.max(...xs) + NODE_W;
  const minY = Math.min(...ys); const maxY = Math.max(...ys) + NODE_H;
  const contentW = maxX - minX; const contentH = maxY - minY;
  const scale = Math.min(svgW / (contentW + 120), svgH / (contentH + 120), 1.2);
  transform.scale = scale;
  transform.x = svgW / 2 - (minX + contentW / 2) * scale;
  transform.y = svgH / 2 - (minY + contentH / 2) * scale;
  updateTransform();
}

function zoomIn()  { transform.scale = Math.min(transform.scale * 1.2, 3); updateTransform(); }
function zoomOut() { transform.scale = Math.max(transform.scale / 1.2, 0.3); updateTransform(); }

function ns(tag) { return document.createElementNS("http://www.w3.org/2000/svg", tag); }
function el(tag, attrs, text) {
  const e = ns(tag);
  Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
  if (text !== undefined) e.textContent = text;
  return e;
}

function makeCurve(x1, y1, x2, y2) {
  const cx = (x1 + x2) / 2;
  return `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`;
}

function renderGraph() {
  scene.innerHTML = "";
  const nodeMap = {};
  NODES.forEach(n => nodeMap[n.id] = n);

  const { layerX, layerOrder, byLayer } = computeLayout(NODES, EDGES);

  /* layer separator lines & labels */
  const ys = NODES.map(n => n.y);
  const minY = Math.min(...ys) - 40;
  const maxY = Math.max(...ys) + NODE_H + 40;

  layerOrder.forEach((layer) => {
    if (byLayer[layer].length === 0) return;
    const x = layerX[layer];
    const lx = x + NODE_W / 2;

    const line = el("line", {
      x1: lx, y1: minY, x2: lx, y2: maxY,
      class: "layer-line"
    });
    scene.appendChild(line);

    const lbl = el("text", {
      x: lx, y: minY - 12,
      class: "layer-label",
      "text-anchor": "middle"
    }, LAYER_NAMES[layer] || layer);
    scene.appendChild(lbl);
  });

  /* edges */
  const edgeEls = {};
  EDGES.forEach((edge) => {
    const src = nodeMap[edge.from]; const tgt = nodeMap[edge.to];
    if (!src || !tgt) return;
    const x1 = src.x + NODE_W;
    const y1 = src.y + NODE_H / 2;
    const x2 = tgt.x;
    const y2 = tgt.y + NODE_H / 2;
    const path = el("path", {
      d: makeCurve(x1, y1, x2, y2),
      class: "edge-path",
      "marker-end": "url(#arrow)",
      "data-from": edge.from,
      "data-to": edge.to
    });
    scene.appendChild(path);
    edgeEls[`${edge.from}→${edge.to}`] = path;
  });

  /* nodes */
  NODES.forEach(n => {
    const style = NODE_STYLES[n.type] || NODE_STYLES.source;
    const g = ns("g");
    g.setAttribute("class", "node-group");
    g.setAttribute("data-id", n.id);

    const rect = el("rect", {
      x: n.x, y: n.y, width: NODE_W, height: NODE_H,
      rx: 6, ry: 6,
      fill: style.fill,
      stroke: style.stroke,
      "stroke-width": "1",
      class: "node-rect"
    });
    g.appendChild(rect);

    /* left accent bar */
    const bar = el("rect", {
      x: n.x, y: n.y + 8, width: 3, height: NODE_H - 16,
      rx: 1.5,
      fill: style.dot
    });
    g.appendChild(bar);

    /* type label */
    const typeLbl = el("text", {
      x: n.x + 14, y: n.y + 17,
      class: "node-label-type",
      fill: style.typeColor
    }, style.typeLabel);
    g.appendChild(typeLbl);

    /* main label */
    const nameLbl = el("text", {
      x: n.x + 14, y: n.y + 32,
      class: "node-label-name"
    }, n.label);
    g.appendChild(nameLbl);

    /* sub label */
    if (n.sub) {
      const subLbl = el("text", {
        x: n.x + 14, y: n.y + 47,
        class: "node-label-sub"
      }, n.sub);
      g.appendChild(subLbl);
    }

    /* hover + click */
    g.addEventListener("mouseenter", (e) => {
      showTooltip(n, e);
      highlightNode(n.id, edgeEls);
    });
    g.addEventListener("mousemove", (e) => moveTooltip(e));
    g.addEventListener("mouseleave", () => {
      hideTooltip();
      if (!selectedId) resetHighlight(edgeEls);
      else highlightNode(selectedId, edgeEls);
    });
    g.addEventListener("click", (e) => {
      e.stopPropagation();
      selectedId = selectedId === n.id ? null : n.id;
      if (selectedId) highlightNode(selectedId, edgeEls);
      else resetHighlight(edgeEls);
    });

    scene.appendChild(g);
  });

  document.getElementById("stat-nodes").textContent = NODES.length;
  document.getElementById("stat-edges").textContent = EDGES.length;
}

/* ═══════════════════════════════════════════════
   HIGHLIGHT LOGIC
   ═══════════════════════════════════════════════ */

function highlightNode(id, edgeEls) {
  const connected = new Set([id]);
  EDGES.forEach(e => {
    if (e.from === id) connected.add(e.to);
    if (e.to === id)   connected.add(e.from);
  });

  document.querySelectorAll(".node-group").forEach(g => {
    g.classList.toggle("dimmed", !connected.has(g.dataset.id));
    g.classList.toggle("selected", g.dataset.id === id);
  });

  Object.entries(edgeEls).forEach(([key, path]) => {
    const [from, to] = key.split("→");
    const active = from === id || to === id;
    path.classList.toggle("highlighted", active);
    path.classList.toggle("dimmed", !active);
    path.setAttribute("marker-end", active ? "url(#arrow-hi)" : "url(#arrow)");
  });
}

function resetHighlight(edgeEls) {
  document.querySelectorAll(".node-group").forEach(g => {
    g.classList.remove("dimmed", "selected");
  });
  Object.values(edgeEls).forEach(p => {
    p.classList.remove("highlighted", "dimmed");
    p.setAttribute("marker-end", "url(#arrow)");
  });
}

function clearSelection() {
  selectedId = null;
  const edgeEls = {};
  document.querySelectorAll(".edge-path").forEach(p => {
    const from = p.dataset.from; const to = p.dataset.to;
    edgeEls[`${from}→${to}`] = p;
  });
  resetHighlight(edgeEls);
}

/* ═══════════════════════════════════════════════
   TOOLTIP
   ═══════════════════════════════════════════════ */

function showTooltip(n, e) {
  const style = NODE_STYLES[n.type] || NODE_STYLES.source;
  const inbound  = EDGES.filter(ed => ed.to === n.id).length;
  const outbound = EDGES.filter(ed => ed.from === n.id).length;
  tip.innerHTML = `
    <div class="tt-type" style="color:${style.typeColor}">${style.typeLabel}</div>
    <div class="tt-name">${n.label}</div>
    ${n.desc ? `<div class="tt-desc">${n.desc}</div>` : ""}
    <div class="tt-row"><span>upstream</span><span>${inbound}</span></div>
    <div class="tt-row"><span>downstream</span><span>${outbound}</span></div>
    ${n.sub ? `<div class="tt-row"><span>source</span><span>${n.sub}</span></div>` : ""}
  `;
  tip.classList.add("visible");
  moveTooltip(e);
}

function moveTooltip(e) {
  const x = e.clientX + 16, y = e.clientY - 10;
  tip.style.left = Math.min(x, window.innerWidth - 240) + "px";
  tip.style.top  = Math.max(y, 60) + "px";
}

function hideTooltip() { tip.classList.remove("visible"); }

/* ═══════════════════════════════════════════════
   PAN & ZOOM
   ═══════════════════════════════════════════════ */

let isPanning = false, panStart = { x: 0, y: 0 };

const wrap = document.getElementById("canvas-wrap");

wrap.addEventListener("mousedown", e => {
  if (e.target.closest(".node-group")) return;
  isPanning = true;
  panStart = { x: e.clientX - transform.x, y: e.clientY - transform.y };
  wrap.classList.add("dragging");
});

window.addEventListener("mousemove", e => {
  if (!isPanning) return;
  transform.x = e.clientX - panStart.x;
  transform.y = e.clientY - panStart.y;
  updateTransform();
});

window.addEventListener("mouseup", () => {
  isPanning = false;
  wrap.classList.remove("dragging");
});

wrap.addEventListener("wheel", e => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.1 : 0.9;
  const rect = svg.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  transform.x = mx - (mx - transform.x) * factor;
  transform.y = my - (my - transform.y) * factor;
  transform.scale = Math.max(0.2, Math.min(3, transform.scale * factor));
  updateTransform();
}, { passive: false });

svg.addEventListener("click", e => {
  if (!e.target.closest(".node-group")) {
    selectedId = null;
    clearSelection();
  }
});

/* ═══════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════
   TAG FILTER
   ═══════════════════════════════════════════════ */

function applyTag(tag) {
  activeTag = tag;

  if (tag === "*") {
    NODES = ALL_NODES;
    EDGES = ALL_EDGES;
  } else {
    NODES = ALL_NODES.filter(n => n.tags && n.tags.includes(tag));
    const nodeIds = new Set(NODES.map(n => n.id));
    EDGES = ALL_EDGES.filter(e => nodeIds.has(e.from) && nodeIds.has(e.to));
  }

  document.querySelectorAll(".tag-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tag === tag);
  });

  selectedId = null;
  renderGraph();
  requestAnimationFrame(resetView);
}

function buildTagBar(nodes) {
  const tags = ["*", ...new Set(
    nodes.flatMap(n => (n.tags || []).filter(t => t !== ""))
  )];

  const bar = document.getElementById("tag-bar");
  bar.innerHTML = "";
  tags.forEach(tag => {
    const btn = document.createElement("button");
    btn.className = "tag-btn" + (tag === activeTag ? " active" : "");
    btn.dataset.tag = tag;
    btn.textContent = tag === "*" ? "all" : tag;
    btn.addEventListener("click", () => applyTag(tag));
    bar.appendChild(btn);
  });
}

window.addEventListener("load", () => {
  fetch("graph.json")
    .then(r => r.json())
    .then(data => {
      ALL_NODES = data.nodes;
      ALL_EDGES = data.edges;
      buildTagBar(ALL_NODES);
      applyTag("*");
    });
});

window.addEventListener("resize", resetView);
