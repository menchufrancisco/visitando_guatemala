// Datos de departamentos cargados asíncronamente desde los archivos JSON.
let DEPARTAMENTOS = [];
const STORAGE_KEY = "sitios-visitados-gt";
const markers = new Map();
const sitesById = new Map();
let visited = new Set();
let map = null;
let userLocationCircle = null;
let userCoordinates = null;
let toastTimer = null;
let leafletPromise = null;

const ICONS = {
  check: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>',
  reset: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>',
};

function showToast(message) {
  const toast = document.getElementById("gt-toast");
  if (!toast) return;
  toast.textContent = message;
  clearTimeout(toastTimer);
  requestAnimationFrame(() => {
    toast.classList.add("show");
    toastTimer = setTimeout(() => toast.classList.remove("show"), 1800);
  });
}

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

function loadVisited() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) visited = new Set(JSON.parse(raw));
  } catch (error) {
    console.warn("No se pudo cargar el progreso guardado:", error);
  }
}

function saveVisited() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(visited)));
  } catch (error) {
    console.warn("No se pudo guardar el progreso:", error);
  }
}

function siteCount() {
  return DEPARTAMENTOS.reduce((total, dept) => total + dept.sites.length, 0);
}

function updateHeader() {
  const totalSites = siteCount();
  const totalVisited = visited.size;
  const pct = totalSites ? Math.round((totalVisited / totalSites) * 100) : 0;
  const completedDepts = DEPARTAMENTOS.filter((dept) => (
    dept.sites.length > 0 && dept.sites.every((site) => visited.has(site.id))
  )).length;

  document.getElementById("gt-stat-num").textContent = `${totalVisited}/${totalSites}`;
  document.getElementById("gt-stat-label").textContent = "sitios";
  document.getElementById("gt-stat-depts").textContent = `${completedDepts} de 22 departamentos`;
  document.getElementById("gt-bar-fill").style.width = `${pct}%`;
}

async function loadData() {
  const [deptsResponse, sitesResponse] = await Promise.all([
    fetch("departamentos.json"),
    fetch("sitios_guatemala.json"),
  ]);

  if (!deptsResponse.ok) {
    throw new Error(`HTTP ${deptsResponse.status} al cargar departamentos`);
  }
  if (!sitesResponse.ok) {
    throw new Error(`HTTP ${sitesResponse.status} al cargar sitios`);
  }

  const departments = await deptsResponse.json();
  const sitesData = await sitesResponse.json();
  DEPARTAMENTOS = departments.map((dept) => {
    const sites = sitesData[dept.id]?.sitios;
    return {
      ...dept,
      sites: Array.isArray(sites)
        ? sites.map((site) => ({
            id: site.id,
            name: site.nombre,
            lat: site.lat,
            lng: site.lng,
            aprox: site.aprox,
          }))
        : [],
    };
  });
  DEPARTAMENTOS.forEach((dept) => {
    dept.sites.forEach((site) => sitesById.set(site.id, site));
  });
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

function buildPopup(site) {
  const wrap = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = site.name;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "gt-popup-btn";
  const updateButtonLabel = () => {
    button.textContent = visited.has(site.id) ? "✓ Visitado (quitar)" : "Marcar como visitado";
  };
  updateButtonLabel();
  button.addEventListener("click", () => {
    toggleSite(site.id);
    updateButtonLabel();
  });

  const link = document.createElement("a");
  link.href = googleMapsUrl(site);
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Cómo llegar en Google Maps";

  wrap.append(title, document.createElement("br"), button, document.createElement("br"), link);
  return wrap;
}

function toggleSite(siteId) {
  if (visited.has(siteId)) visited.delete(siteId);
  else visited.add(siteId);

  const site = sitesById.get(siteId);
  showToast(`${visited.has(siteId) ? "✓" : "✗"} ${site?.name || siteId}`);
  saveVisited();

  if (site && markers.has(siteId)) {
    markers.get(siteId).setIcon(markerIcon(site));
  }
  updateHeader();
  if (userCoordinates) renderNearbySites(userCoordinates);
  applyFilters();
}

function addDepartmentOptions() {
  const select = document.getElementById("gt-department-filter");
  DEPARTAMENTOS.forEach((dept) => {
    const option = document.createElement("option");
    option.value = dept.id;
    option.textContent = dept.name;
    select.appendChild(option);
  });
}

function applyFilters() {
  if (!map) return;

  const selectedDepartment = document.getElementById("gt-department-filter").value;
  const onlyPending = document.getElementById("gt-pending-filter").checked;
  const visibleMarkers = [];

  DEPARTAMENTOS.forEach((dept) => {
    dept.sites.forEach((site) => {
      const marker = markers.get(site.id);
      if (!marker) return;

      const visible = (selectedDepartment === "all" || dept.id === selectedDepartment)
        && (!onlyPending || !visited.has(site.id));
      if (visible) {
        if (!map.hasLayer(marker)) marker.addTo(map);
        visibleMarkers.push(marker);
      } else if (map.hasLayer(marker)) {
        map.removeLayer(marker);
      }
    });
  });

  if (visibleMarkers.length > 1) {
    const bounds = L.latLngBounds(visibleMarkers.map((marker) => marker.getLatLng()));
    map.fitBounds(bounds, { padding: [28, 28], maxZoom: 12 });
  } else if (visibleMarkers.length === 1) {
    map.setView(visibleMarkers[0].getLatLng(), 11);
  } else {
    map.setView([15.7835, -90.2308], 7);
  }

  if (userCoordinates) renderNearbySites(userCoordinates);
}

function haversineDistance(lat1, lng1, lat2, lng2) {
  const earthRadiusKm = 6371;
  const toRadians = (degrees) => degrees * (Math.PI / 180);
  const latitudeDelta = toRadians(lat2 - lat1);
  const longitudeDelta = toRadians(lng2 - lng1);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2))
    * Math.sin(longitudeDelta / 2) ** 2;

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function renderNearbySites(position) {
  const nearbySection = document.getElementById("gt-nearby");
  const list = document.getElementById("gt-nearby-list");
  const selectedDepartment = document.getElementById("gt-department-filter").value;
  const nearestSites = DEPARTAMENTOS
    .filter((dept) => selectedDepartment === "all" || dept.id === selectedDepartment)
    .flatMap((dept) => dept.sites)
    .filter((site) => !visited.has(site.id) && hasValidCoordinates(site))
    .map((site) => ({
      site,
      distance: haversineDistance(
        position.lat,
        position.lng,
        Number(site.lat),
        Number(site.lng),
      ),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 10);

  list.replaceChildren();
  if (nearestSites.length === 0) {
    const emptyMessage = document.createElement("li");
    emptyMessage.className = "gt-nearby-empty";
    emptyMessage.textContent = "No hay sitios pendientes en este filtro.";
    list.appendChild(emptyMessage);
  } else {
    nearestSites.forEach(({ site, distance }) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "gt-nearby-item";

      const name = document.createElement("span");
      name.className = "gt-nearby-name";
      name.textContent = site.name;

      const distanceLabel = document.createElement("span");
      distanceLabel.className = "gt-nearby-distance";
      distanceLabel.textContent = `${distance.toFixed(1)} km`;

      button.append(name, distanceLabel);
      button.addEventListener("click", () => {
        const marker = markers.get(site.id);
        if (!marker) return;
        if (!map.hasLayer(marker)) marker.addTo(map);
        map.setView(marker.getLatLng(), 13);
        marker.openPopup();
      });
      item.appendChild(button);
      list.appendChild(item);
    });
  }

  nearbySection.hidden = false;
}

function locateNearbySites() {
  if (!navigator.geolocation) {
    showToast("Se necesita permiso de ubicación para encontrar sitios cercanos.");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      userCoordinates = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };
      map.setView([userCoordinates.lat, userCoordinates.lng], 11);

      if (userLocationCircle) {
        userLocationCircle.setLatLng([userCoordinates.lat, userCoordinates.lng]);
      } else {
        userLocationCircle = L.circle([userCoordinates.lat, userCoordinates.lng], {
          radius: 180,
          color: "#2788e8",
          fillColor: "#2788e8",
          fillOpacity: 0.2,
          weight: 2,
        }).addTo(map);
      }

      renderNearbySites(userCoordinates);
    },
    () => {
      showToast("Se necesita permiso de ubicación para encontrar sitios cercanos. Revisa el permiso e inténtalo de nuevo.");
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
  );
}

function createMap() {
  map = L.map("gt-leaflet-map").setView([15.7835, -90.2308], 7);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(map);

  DEPARTAMENTOS.forEach((dept) => {
    dept.sites.filter(hasValidCoordinates).forEach((site) => {
      const marker = L.marker([Number(site.lat), Number(site.lng)], { icon: markerIcon(site) })
        .bindPopup(buildPopup(site));
      markers.set(site.id, marker);
    });
  });

  addDepartmentOptions();
  document.getElementById("gt-department-filter").addEventListener("change", applyFilters);
  document.getElementById("gt-pending-filter").addEventListener("change", applyFilters);
  document.getElementById("gt-nearby-btn").addEventListener("click", locateNearbySites);
  applyFilters();
}

function resetAll() {
  if (!confirm("¿Borrar todo tu progreso? Esta acción no se puede deshacer.")) return;
  visited.clear();
  saveVisited();
  markers.forEach((marker, siteId) => {
    const site = sitesById.get(siteId);
    if (site) marker.setIcon(markerIcon(site));
  });
  updateHeader();
  applyFilters();
}

function showLoadError(message) {
  const mapElement = document.getElementById("gt-leaflet-map");
  mapElement.innerHTML = `<p class="gt-map-error">${message}</p>`;
}

async function init() {
  loadVisited();
  document.getElementById("gt-reset").innerHTML = `${ICONS.reset} Reiniciar progreso`;
  document.getElementById("gt-reset").addEventListener("click", resetAll);

  try {
    await Promise.all([loadData(), loadLeaflet()]);
    createMap();
    updateHeader();
    requestAnimationFrame(() => map.invalidateSize());
  } catch (error) {
    console.error("No se pudo iniciar el mapa:", error);
    showLoadError("No se pudo cargar el mapa o los sitios. Revisa tu conexión e intenta recargar la página.");
  }
}

document.addEventListener("DOMContentLoaded", init);
