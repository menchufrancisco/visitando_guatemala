// Datos de departamentos cargados asíncronamente desde departamentos.json
let DEPARTAMENTOS = [];
const VIEW_W = 800;
const VIEW_H = 844;
const STORAGE_KEY = "sitios-visitados-gt";

const ICONS = {
  check: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>',
  x: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
  mapPin: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>',
  reset: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>',
};

let toastTimer = null;
function showToast(msg) {
  const toast = document.getElementById("gt-toast");
  if (!toast) return;
  toast.textContent = msg;
  clearTimeout(toastTimer);
  requestAnimationFrame(() => {
    toast.classList.add("show");
    toastTimer = setTimeout(() => toast.classList.remove("show"), 1800);
  });
}

// Carga perezosa (lazy load) de Leaflet
let leafletPromise = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;

  leafletPromise = new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(link);

    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.onload = () => resolve(window.L);
    script.onerror = () => {
      leafletPromise = null;
      reject(new Error("No se pudo cargar Leaflet"));
    };
    document.body.appendChild(script);
  });
  return leafletPromise;
}

let visited = new Set();
let selected = null;
let detailMap = null;
const detailMarkers = new Map();

function loadVisited() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) visited = new Set(JSON.parse(raw));
  } catch (e) { /* sin datos guardados */ }
}

function saveVisited() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(visited)));
  } catch (e) {
    console.warn("No se pudo guardar el progreso:", e);
  }
}

function deptProgress(dept) {
  const count = dept.sites.filter((s) => visited.has(s.id)).length;
  return { count, total: dept.sites.length };
}

function colorFor(dept) {
  const { count, total } = deptProgress(dept);
  if (count === 0) return "var(--stone)";
  if (count === total) return "var(--jade)";
  return "var(--gold)";
}

function totalStats() {
  const totalSites = DEPARTAMENTOS.reduce((a, d) => a + d.sites.length, 0);
  const totalVisited = visited.size;
  const pct = totalSites ? Math.round((totalVisited / totalSites) * 100) : 0;
  return { totalSites, totalVisited, pct };
}

function buildMap() {
  const svg = document.getElementById("gt-svg");
  svg.setAttribute("viewBox", `0 0 ${VIEW_W} ${VIEW_H}`);
  svg.innerHTML = "";

  DEPARTAMENTOS.forEach((d) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d.path);
    path.setAttribute("class", "gt-dept-path");
    path.setAttribute("data-dept", d.id);
    path.setAttribute("role", "button");
    path.setAttribute("tabindex", "0");
    path.addEventListener("click", () => selectDept(d.id));
    path.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectDept(d.id); }
    });
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = d.name;
    path.appendChild(title);
    svg.appendChild(path);
  });

  DEPARTAMENTOS.forEach((d) => {
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("cx", d.cx);
    dot.setAttribute("cy", d.cy);
    dot.setAttribute("r", 2);
    dot.setAttribute("class", "gt-dept-dot");
    dot.setAttribute("data-dept-dot", d.id);
    svg.appendChild(dot);
  });

  // Department name labels
  DEPARTAMENTOS.forEach((d) => {
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", d.cx);
    text.setAttribute("y", d.cy + 9);
    text.setAttribute("class", "gt-dept-label");
    text.textContent = d.name;
    svg.appendChild(text);
  });
}

function updateMapColors() {
  DEPARTAMENTOS.forEach((d) => {
    const el = document.querySelector(`path[data-dept="${d.id}"]`);
    if (!el) return;
    el.style.fill = colorFor(d);
    el.classList.toggle("selected", selected === d.id);
    const dot = document.querySelector(`circle[data-dept-dot="${d.id}"]`);
    if (dot) dot.setAttribute("r", selected === d.id ? 3 : 2);
    const { count, total } = deptProgress(d);
    const titleEl = el.querySelector("title");
    if (titleEl) titleEl.textContent = `${d.name}: ${count}/${total}`;
    el.setAttribute("aria-label", `${d.name}: ${count} de ${total} sitios visitados`);
  });
}

function updateHeader() {
  const { totalSites, totalVisited, pct } = totalStats();
  document.getElementById("gt-stat-num").textContent = `${totalVisited}/${totalSites}`;
  document.getElementById("gt-stat-label").textContent = "sitios";
  
  // Contar departamentos completos
  const completedDepts = DEPARTAMENTOS.filter(d => {
    const { count, total } = deptProgress(d);
    return total > 0 && count === total;
  }).length;
  
  document.getElementById("gt-stat-depts").textContent = `${completedDepts} de 22 departamentos`;
  document.getElementById("gt-bar-fill").style.width = `${pct}%`;
}

function selectDept(id) {
  selected = id;
  updateMapColors();
  showDetailView();
}

function closeDept() {
  selected = null;
  destroyDetailMap();
  const mainView = document.getElementById("gt-main-view");
  mainView.hidden = false;
  mainView.classList.remove("gt-fade-enter");
  void mainView.offsetWidth;
  mainView.classList.add("gt-fade-enter");
  document.getElementById("gt-detail-view").hidden = true;
  updateMapColors();
  renderPanel();
}

function toggleSite(siteId) {
  if (visited.has(siteId)) visited.delete(siteId);
  else visited.add(siteId);
  const justAdded = visited.has(siteId);
  const siteName = DEPARTAMENTOS.flatMap(d => d.sites).find(s => s.id === siteId)?.name || siteId;
  showToast(justAdded ? `✓ ${siteName}` : `✗ ${siteName}`);
  saveVisited();
  updateMapColors();
  updateHeader();
  if (selected) {
    const dept = DEPARTAMENTOS.find((item) => item.id === selected);
    if (dept) {
      renderDetailSites(dept);
      updateDetailMarkers();
    }
  } else {
    renderPanel();
  }
}

function resetAll() {
  if (!confirm("¿Borrar todo tu progreso? Esta acción no se puede deshacer.")) return;
  visited = new Set();
  saveVisited();
  updateMapColors();
  updateHeader();
  if (selected) {
    const dept = DEPARTAMENTOS.find((item) => item.id === selected);
    if (dept) {
      renderDetailSites(dept);
      updateDetailMarkers();
    }
  } else {
    renderPanel();
  }
}

async function loadData() {
  try {
    const [deptsRes, sitesRes] = await Promise.all([
      fetch("departamentos.json"),
      fetch("sitios_guatemala.json")
    ]);

    if (!deptsRes.ok) throw new Error(`HTTP ${deptsRes.status} al cargar departamentos`);
    if (!sitesRes.ok) throw new Error(`HTTP ${sitesRes.status} al cargar sitios`);

    DEPARTAMENTOS = await deptsRes.json();
    const sitesData = await sitesRes.json();

    DEPARTAMENTOS.forEach((dept) => {
      const sites = sitesData[dept.id]?.sitios;
      dept.sites = Array.isArray(sites)
        ? sites.map((site) => ({
            id: site.id,
            name: site.nombre,
            lat: site.lat,
            lng: site.lng,
            aprox: site.aprox,
          }))
        : [];
    });
  } catch (error) {
    console.error("Error al cargar datos:", error);
    const panel = document.getElementById("gt-panel");
    if (panel) {
      panel.innerHTML = `
        <div class="gt-panel-empty">
          <p style="color:var(--brick)">⚠️ No se pudieron cargar los datos de los sitios. Por favor revisa tu conexión o intenta recargar la página.</p>
        </div>`;
    }
  }
}

function hasValidCoordinates(site) {
  return Number.isFinite(Number(site.lat)) && Number.isFinite(Number(site.lng))
    && Number(site.lat) >= -90 && Number(site.lat) <= 90
    && Number(site.lng) >= -180 && Number(site.lng) <= 180;
}

function markerIcon(site) {
  const state = visited.has(site.id) ? " visited" : "";
  return L.divIcon({
    className: "gt-leaflet-pin-wrapper",
    html: `<span class="gt-leaflet-pin${state}" aria-hidden="true"></span>`,
    iconSize: [22, 30],
    iconAnchor: [11, 30],
    popupAnchor: [0, -30],
  });
}

function googleMapsUrl(site) {
  const destination = `${Number(site.lat)},${Number(site.lng)}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

function destroyDetailMap() {
  detailMarkers.clear();
  if (detailMap) {
    detailMap.remove();
    detailMap = null;
  }
}

function buildPopup(site) {
  const wrap = document.createElement("div");

  const title = document.createElement("strong");
  title.textContent = site.name;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "gt-popup-btn";
  const label = () => (visited.has(site.id) ? "✓ Visitado (quitar)" : "Marcar como visitado");
  btn.textContent = label();
  btn.addEventListener("click", () => {
    toggleSite(site.id);
    btn.textContent = label();
  });

  const link = document.createElement("a");
  link.href = googleMapsUrl(site);
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Cómo llegar en Google Maps";

  wrap.append(title, document.createElement("br"), btn, document.createElement("br"), link);
  return wrap;
}

function createDetailMap(dept) {
  if (!window.L) {
    console.error("Leaflet no se pudo cargar; no se puede mostrar el mapa de detalle.");
    return;
  }

  destroyDetailMap();

  const mappedSites = dept.sites.filter(hasValidCoordinates);
  const center = mappedSites.length
    ? [
        mappedSites.reduce((sum, site) => sum + Number(site.lat), 0) / mappedSites.length,
        mappedSites.reduce((sum, site) => sum + Number(site.lng), 0) / mappedSites.length,
      ]
    : [15.7835, -90.2308];
  const zoom = mappedSites.length === 0 ? 7 : mappedSites.length === 1 ? 11 : 9;

  detailMap = L.map("gt-leaflet-map").setView(center, zoom);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(detailMap);

  mappedSites.forEach((site) => {
    const marker = L.marker([Number(site.lat), Number(site.lng)], { icon: markerIcon(site) })
      .addTo(detailMap)
      .bindPopup(buildPopup(site));
    detailMarkers.set(site.id, marker);
  });

  if (mappedSites.length > 1) {
    const bounds = L.latLngBounds(mappedSites.map((site) => [Number(site.lat), Number(site.lng)]));
    detailMap.fitBounds(bounds, { padding: [30, 30] });
  }
}

function updateDetailMarkers() {
  detailMarkers.forEach((marker, siteId) => {
    const site = DEPARTAMENTOS.find((dept) => dept.id === selected)?.sites.find((item) => item.id === siteId);
    if (site) marker.setIcon(markerIcon(site));
  });
}

function renderDetailSites(dept) {
  const { count, total } = deptProgress(dept);
  document.getElementById("gt-detail-title").textContent = dept.name;
  document.getElementById("gt-detail-progress").textContent = `${count} de ${total} sitios visitados`;

  const rows = dept.sites.map((site) => {
    const done = visited.has(site.id);
    return `<li class="gt-detail-site-row" data-detail-toggle="${site.id}">
      <span class="gt-checkbox ${done ? "checked" : ""}">${done ? ICONS.check : ""}</span>
      <span class="gt-site-name ${done ? "done" : ""}">${site.name}</span>
    </li>`;
  }).join("");

  document.getElementById("gt-detail-sites").innerHTML = `
    <div class="gt-detail-sites-head">
      <h3>Sitios turísticos</h3>
      <p>Selecciona un sitio para marcarlo como visitado.</p>
    </div>
    <ul class="gt-detail-site-list">${rows}</ul>`;

  document.querySelectorAll("[data-detail-toggle]").forEach((row) => {
    row.addEventListener("click", () => toggleSite(row.getAttribute("data-detail-toggle")));
  });
}

async function showDetailView() {
  const dept = DEPARTAMENTOS.find((item) => item.id === selected);
  if (!dept) return;

  document.getElementById("gt-main-view").hidden = true;
  const detailView = document.getElementById("gt-detail-view");
  detailView.hidden = false;
  detailView.classList.remove("gt-fade-enter");
  void detailView.offsetWidth;
  detailView.classList.add("gt-fade-enter");
  renderDetailSites(dept);

  // Si Leaflet aún no está cargado, mostrar spinner mientras se descarga
  if (!window.L) {
    const mapEl = document.getElementById("gt-leaflet-map");
    mapEl.innerHTML = '<div class="gt-loading" style="height:100%;min-height:400px;"><div class="gt-spinner"></div>Cargando mapa interactivo…</div>';
    try {
      await loadLeaflet();
    } catch (e) {
      mapEl.innerHTML = '<div class="gt-loading" style="color:var(--brick)">⚠️ No se pudo cargar el mapa interactivo. Revisa tu conexión.</div>';
      return;
    }
    mapEl.innerHTML = "";
  }
  createDetailMap(dept);
}

function renderPanel() {
  const panel = document.getElementById("gt-panel");
  const dept = DEPARTAMENTOS.find((d) => d.id === selected);
  const previousListScroll = panel.querySelector(".gt-site-list")?.scrollTop ?? 0;

  if (!dept) {
    const rows = DEPARTAMENTOS.map((d) => {
      const { count, total } = deptProgress(d);
      const pct = total ? Math.round((count / total) * 100) : 0;
      const color = colorFor(d);
      return `<li>
        <button data-select="${d.id}">
          <span class="gt-mini-dot" style="background:${color}"></span>
          <div class="gt-dept-info">
            <div class="gt-dept-name-row">
              <span class="gt-dept-name-text">${d.name}</span>
              <span class="gt-mini-count">${count}/${total}</span>
            </div>
            <div class="gt-mini-bar">
              <div class="gt-mini-bar-fill" style="width:${pct}%;background:${color}"></div>
            </div>
          </div>
        </button>
      </li>`;
    }).join("");

    panel.innerHTML = `
      <div class="gt-panel-empty">
        <div class="gt-panel-empty-icon">📍</div>
        <p>Toca cualquier departamento del mapa o de la lista para ver sus sitios y marcar los que ya visitaste.</p>
        <ul class="gt-dept-list">${rows}</ul>
      </div>`;

    const list = panel.querySelector(".gt-dept-list");
    if (list) list.scrollTop = previousListScroll;

    panel.querySelectorAll("[data-select]").forEach((btn) => {
      btn.addEventListener("click", () => selectDept(btn.getAttribute("data-select")));
    });
    return;
  }

  const { count, total } = deptProgress(dept);
  const siteRows = dept.sites.map((s) => {
    const done = visited.has(s.id);
    return `<li class="gt-site-row" data-toggle="${s.id}">
      <span class="gt-checkbox ${done ? "checked" : ""}">${done ? ICONS.check : ""}</span>
      <span class="gt-site-name ${done ? "done" : ""}">${s.name}</span>
    </li>`;
  }).join("");

  panel.innerHTML = `
    <div class="gt-panel-head">
      <div>
        <h2 class="gt-dept-name">${dept.name}</h2>
        <p class="gt-dept-sub">${count} de ${total} sitios visitados</p>
      </div>
      <button class="gt-close-btn" id="gt-close" aria-label="Cerrar">${ICONS.x}</button>
    </div>
    <ul class="gt-site-list">${siteRows}</ul>`;

  const list = panel.querySelector(".gt-site-list");
  if (list) list.scrollTop = previousListScroll;

  document.getElementById("gt-close").addEventListener("click", closeDept);
  panel.querySelectorAll("[data-toggle]").forEach((row) => {
    row.addEventListener("click", () => toggleSite(row.getAttribute("data-toggle")));
  });
}

async function init() {
  loadVisited();
  document.getElementById("gt-panel").innerHTML = '<div class="gt-loading"><div class="gt-spinner"></div>Cargando sitios…</div>';
  await loadData();
  buildMap();
  updateMapColors();
  updateHeader();
  renderPanel();
  document.getElementById("gt-reset").innerHTML = `${ICONS.reset} Reiniciar progreso`;
  document.getElementById("gt-reset").addEventListener("click", resetAll);
  document.getElementById("gt-back-btn").addEventListener("click", closeDept);

  // Precargar Leaflet en segundo plano cuando el navegador esté ocioso
  if ("requestIdleCallback" in window) {
    requestIdleCallback(() => loadLeaflet());
  } else {
    setTimeout(loadLeaflet, 2500);
  }
}

document.addEventListener("DOMContentLoaded", init);
