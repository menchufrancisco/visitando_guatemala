const SUPABASE_URL = "https://gdxegctxwjaywbhnjtzz.supabase.co";
const SUPABASE_KEY = "sb_publishable_iXl1-FcocRI0iR45rklr8g_w8uStkrx";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

async function enviarSugerencia({ departamento_id, nombre, lat, lng, comentario }) {
  const headers = { "apikey": SUPABASE_KEY, "Content-Type": "application/json", "Prefer": "return=minimal" };
  if (SUPABASE_KEY.startsWith("eyJ")) headers["Authorization"] = `Bearer ${SUPABASE_KEY}`;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/sugerencias`, {
    method: "POST", headers,
    body: JSON.stringify({ departamento_id, nombre, lat, lng, comentario: comentario || null }),
  });
  if (!res.ok) throw new Error(`Error ${res.status}: ${await res.text()}`);
}

// Datos de departamentos cargados asíncronamente desde los archivos JSON.
let DEPARTAMENTOS = [];
let SUGGESTION_DEPARTMENTS = [];
const STORAGE_KEY = "sitios-visitados-gt";
const markers = new Map();
const sitesById = new Map();
let visited = new Set();
let map = null;
let userLocationCircle = null;
let userCoordinates = null;
let locationActive = false;
let suggestionMarker = null;
let suggestionCoordinates = null;
let toastTimer = null;
let leafletPromise = null;
let currentUser = null;
let authSyncVersion = 0;
let idMapPromise = null;
const pendingSiteUpdates = new Set();

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

async function migrateVisitedIds() {
  const legacyIds = Array.from(visited).filter((siteId) => /^[a-z]+-\d+$/.test(siteId));
  if (legacyIds.length === 0) return;

  if (!idMapPromise) {
    idMapPromise = fetch("mapa_ids.json").then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status} al cargar mapa_ids.json`);
      return response.json();
    });
  }

  try {
    const idMap = await idMapPromise;
    const stableIdsByDepartment = new Map();
    Object.values(idMap).forEach((stableId) => {
      if (typeof stableId !== "string") return;
      const separator = stableId.indexOf("-");
      if (separator === -1) return;
      const departmentId = stableId.slice(0, separator);
      if (!stableIdsByDepartment.has(departmentId)) stableIdsByDepartment.set(departmentId, []);
      stableIdsByDepartment.get(departmentId).push(stableId);
    });

    let changed = false;
    const migrated = new Set();
    visited.forEach((siteId) => {
      let stableId = idMap[siteId];
      if (!stableId && /^[a-z]+-\d+$/.test(siteId)) {
        const [departmentId, indexText] = siteId.split("-");
        stableId = stableIdsByDepartment.get(departmentId)?.[Number(indexText)];
      }
      migrated.add(stableId || siteId);
      if (stableId && stableId !== siteId) changed = true;
    });

    if (changed) {
      visited = migrated;
      saveVisited();
    }
  } catch (error) {
    console.warn("No se pudo migrar los IDs del progreso guardado:", error);
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

function refreshProgressUI() {
  markers.forEach((marker, siteId) => {
    const site = sitesById.get(siteId);
    if (site) marker.setIcon(markerIcon(site));
  });
  updateHeader();
  if (userCoordinates) renderNearbySites(userCoordinates);
  applyFilters();
}

function updateAuthUI(user) {
  const loginButton = document.getElementById("gt-auth-login");
  const userPanel = document.getElementById("gt-auth-user");
  const email = document.getElementById("gt-auth-email");
  loginButton.hidden = Boolean(user);
  userPanel.hidden = !user;
  email.textContent = user?.email || "";
}

async function syncVisitsForUser(user) {
  const syncVersion = ++authSyncVersion;
  const { data, error } = await sb
    .from("visitas")
    .select("sitio_id")
    .eq("user_id", user.id);

  if (error) throw error;
  if (syncVersion !== authSyncVersion || currentUser?.id !== user.id) return;

  const cloudIds = new Set((data || []).map((row) => row.sitio_id));
  const localIds = new Set(visited);
  const localOnlyRows = Array.from(localIds)
    .filter((siteId) => !cloudIds.has(siteId))
    .map((sitio_id) => ({ user_id: user.id, sitio_id }));

  visited = new Set([...cloudIds, ...localIds]);
  saveVisited();
  refreshProgressUI();

  if (localOnlyRows.length > 0) {
    const { error: uploadError } = await sb
      .from("visitas")
      .upsert(localOnlyRows, {
        onConflict: "user_id,sitio_id",
        ignoreDuplicates: true,
      });
    if (uploadError) throw uploadError;
  }
}

async function handleAuthStateChange(event, session) {
  const user = session?.user || null;
  if (!user) {
    updateAuthUI(null);
    if (event === "SIGNED_OUT") {
      authSyncVersion += 1;
      currentUser = null;
      visited.clear();
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (error) {
        console.warn("No se pudo borrar el progreso local:", error);
      }
      refreshProgressUI();
    }
    return;
  }

  if (currentUser && currentUser.id !== user.id) {
    visited.clear();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.warn("No se pudo borrar el progreso local de la cuenta anterior:", error);
    }
  }
  currentUser = user;
  updateAuthUI(user);

  try {
    await syncVisitsForUser(user);
  } catch (error) {
    console.error("No se pudo sincronizar las visitas:", error);
    showToast(`No se pudo sincronizar el progreso: ${error.message || error}`);
  }
}

function setupAuth() {
  document.getElementById("gt-auth-login").addEventListener("click", async () => {
    try {
      const { error } = await sb.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin + window.location.pathname,
        },
      });
      if (error) throw error;
    } catch (error) {
      console.error("No se pudo iniciar sesión con Google:", error);
      showToast(`No se pudo iniciar sesión: ${error.message || error}`);
    }
  });
  document.getElementById("gt-auth-logout").addEventListener("click", async () => {
    try {
      const { error } = await sb.auth.signOut();
      if (error) throw error;
    } catch (error) {
      console.error("No se pudo cerrar sesión:", error);
      showToast(`No se pudo cerrar sesión: ${error.message || error}`);
    }
  });

  sb.auth.onAuthStateChange((event, session) => {
    setTimeout(() => {
      handleAuthStateChange(event, session).catch((error) => {
        console.error("Error al procesar el estado de autenticación:", error);
        showToast(`Error de autenticación: ${error.message || error}`);
      });
    }, 0);
  });
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
  SUGGESTION_DEPARTMENTS = Object.entries(sitesData).map(([id, data]) => ({
    id,
    name: data.departamento,
  }));
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
  button.addEventListener("click", async () => {
    button.disabled = true;
    await toggleSite(site.id);
    updateButtonLabel();
    button.disabled = false;
  });

  const link = document.createElement("a");
  link.href = googleMapsUrl(site);
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Cómo llegar en Google Maps";

  wrap.append(title, document.createElement("br"), button, document.createElement("br"), link);
  return wrap;
}

async function toggleSite(siteId) {
  if (pendingSiteUpdates.has(siteId)) return;
  pendingSiteUpdates.add(siteId);

  const wasVisited = visited.has(siteId);
  if (wasVisited) visited.delete(siteId);
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

  const user = currentUser;
  if (!user) {
    pendingSiteUpdates.delete(siteId);
    return;
  }

  try {
    const result = wasVisited
      ? await sb.from("visitas").delete().eq("user_id", user.id).eq("sitio_id", siteId)
      : await sb.from("visitas").insert({ sitio_id: siteId });
    if (result.error) throw result.error;
  } catch (error) {
    console.error("No se pudo guardar el cambio de visita:", error);
    if (currentUser?.id === user.id) {
      if (wasVisited) visited.add(siteId);
      else visited.delete(siteId);
      saveVisited();
      refreshProgressUI();
    }
    showToast(`No se pudo guardar el cambio: ${error.message || error}`);
  } finally {
    pendingSiteUpdates.delete(siteId);
  }
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
  if (locationActive) {
    disableNearbyLocation();
    return;
  }

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
      locationActive = true;

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

      const selectedDepartment = document.getElementById("gt-department-filter").value;
      const closestSite = DEPARTAMENTOS
        .filter((dept) => selectedDepartment === "all" || dept.id === selectedDepartment)
        .flatMap((dept) => dept.sites)
        .filter(hasValidCoordinates)
        .map((site) => ({
          site,
          distance: haversineDistance(
            userCoordinates.lat,
            userCoordinates.lng,
            Number(site.lat),
            Number(site.lng),
          ),
        }))
        .sort((a, b) => a.distance - b.distance)[0];

      const button = document.getElementById("gt-nearby-btn");
      button.textContent = "✕ Quitar ubicación";
      if (closestSite) {
        const closestDepartment = DEPARTAMENTOS.find((dept) => (
          dept.sites.some((site) => site.id === closestSite.site.id)
        ));
        if (closestDepartment) {
          document.getElementById("gt-department-filter").value = closestDepartment.id;
        }
      }
      applyFilters();
      showToast(`Ubicación aproximada: ±${Math.round(position.coords.accuracy)} m`);
    },
    () => {
      showToast("Se necesita permiso de ubicación para encontrar sitios cercanos. Revisa el permiso e inténtalo de nuevo.");
    },
    { enableHighAccuracy: true, timeout: 10000 },
  );
}

function disableNearbyLocation() {
  locationActive = false;
  userCoordinates = null;
  if (userLocationCircle) {
    map.removeLayer(userLocationCircle);
    userLocationCircle = null;
  }

  document.getElementById("gt-nearby").hidden = true;
  document.getElementById("gt-nearby-list").replaceChildren();
  document.getElementById("gt-nearby-btn").textContent = "📍 Cerca de mí";
  document.getElementById("gt-department-filter").value = "all";
  document.getElementById("gt-pending-filter").checked = false;
  applyFilters();
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
  setupSuggestionForm();
  document.getElementById("gt-department-filter").addEventListener("change", applyFilters);
  document.getElementById("gt-pending-filter").addEventListener("change", applyFilters);
  document.getElementById("gt-nearby-btn").addEventListener("click", locateNearbySites);
  map.on("click", (event) => {
    if (document.getElementById("gt-suggestion-panel").hidden) return;
    if (event.originalEvent.target.closest(".leaflet-marker-icon, .leaflet-control")) return;
    setSuggestionCoordinates(event.latlng.lat, event.latlng.lng);
  });
  applyFilters();
}

function setupSuggestionForm() {
  const departmentSelect = document.getElementById("gt-suggestion-department");
  SUGGESTION_DEPARTMENTS.forEach(({ id, name }) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = name;
    departmentSelect.appendChild(option);
  });

  const panel = document.getElementById("gt-suggestion-panel");
  const toggle = document.getElementById("gt-suggestion-toggle");
  const closePanel = () => {
    panel.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
  };

  toggle.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) {
      const selectedDepartment = document.getElementById("gt-department-filter").value;
      departmentSelect.value = selectedDepartment === "all" ? "" : selectedDepartment;
    }
  });
  document.getElementById("gt-suggestion-close").addEventListener("click", closePanel);
  document.getElementById("gt-suggestion-location").addEventListener("click", useLocationForSuggestion);
  document.getElementById("gt-suggestion-form").addEventListener("submit", (event) => {
    event.preventDefault();
    submitSuggestion(closePanel);
  });
}

function isInGuatemala(lat, lng) {
  return lat >= 13.5 && lat <= 18 && lng >= -92.4 && lng <= -88.2;
}

function setSuggestionCoordinates(lat, lng) {
  suggestionCoordinates = { lat, lng };
  if (suggestionMarker) {
    suggestionMarker.setLatLng([lat, lng]);
  } else {
    suggestionMarker = L.marker([lat, lng], { draggable: true }).addTo(map);
    suggestionMarker.on("dragend", () => {
      const point = suggestionMarker.getLatLng();
      setSuggestionCoordinates(point.lat, point.lng);
    });
  }

  document.getElementById("gt-suggestion-lat").textContent = lat.toFixed(6);
  document.getElementById("gt-suggestion-lng").textContent = lng.toFixed(6);
}

function useLocationForSuggestion() {
  if (!navigator.geolocation) {
    showToast("No se pudo acceder a tu ubicación. Selecciona el punto en el mapa.");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      setSuggestionCoordinates(latitude, longitude);
      map.setView([latitude, longitude], 13);
      if (!isInGuatemala(latitude, longitude)) {
        showToast("La ubicación está fuera de Guatemala. Selecciona un punto dentro del país.");
      }
    },
    () => showToast("No se pudo obtener tu ubicación. Revisa el permiso o selecciona el punto en el mapa."),
    { enableHighAccuracy: true, timeout: 10000 },
  );
}

async function submitSuggestion(closePanel) {
  const submitButton = document.getElementById("gt-suggestion-submit");
  const honeypot = document.getElementById("gt-suggestion-web").value.trim();
  if (honeypot) {
    showToast("¡Gracias! Lo reviso pronto");
    closePanel();
    return;
  }

  const departamento_id = document.getElementById("gt-suggestion-department").value;
  const nombre = document.getElementById("gt-suggestion-name").value.trim();
  const comentario = document.getElementById("gt-suggestion-comment").value.trim();
  if (!departamento_id || nombre.length < 3 || nombre.length > 120 || comentario.length > 500) {
    showToast("Revisa el departamento, el nombre (3–120 caracteres) y el comentario (máx. 500).");
    return;
  }
  if (!suggestionCoordinates || !isInGuatemala(suggestionCoordinates.lat, suggestionCoordinates.lng)) {
    showToast("Selecciona en el mapa unas coordenadas válidas dentro de Guatemala.");
    return;
  }

  submitButton.disabled = true;
  try {
    await enviarSugerencia({
      departamento_id,
      nombre,
      lat: suggestionCoordinates.lat,
      lng: suggestionCoordinates.lng,
      comentario,
    });
    showToast("¡Gracias! Lo reviso pronto");
  } catch (error) {
    console.error("No se pudo enviar la sugerencia:", error);
    showToast(`No se pudo enviar la sugerencia. ${error.message}`);
  } finally {
    submitButton.disabled = false;
    closePanel();
  }
}

async function resetAll() {
  if (!confirm("¿Borrar todo tu progreso? Esta acción no se puede deshacer.")) return;

  const user = currentUser;
  if (user) {
    const { error } = await sb.from("visitas").delete().eq("user_id", user.id);
    if (error) {
      console.error("No se pudo borrar el progreso sincronizado:", error);
      showToast(`No se pudo borrar el progreso: ${error.message}`);
      return;
    }
    if (currentUser?.id !== user.id) return;
  }

  visited.clear();
  saveVisited();
  refreshProgressUI();
}

function showLoadError(message) {
  const mapElement = document.getElementById("gt-leaflet-map");
  mapElement.innerHTML = `<p class="gt-map-error">${message}</p>`;
}

async function init() {
  loadVisited();
  await migrateVisitedIds();
  document.getElementById("gt-reset").innerHTML = `${ICONS.reset} Reiniciar progreso`;
  document.getElementById("gt-reset").addEventListener("click", () => {
    resetAll().catch((error) => {
      console.error("No se pudo reiniciar el progreso:", error);
      showToast(`No se pudo reiniciar el progreso: ${error.message || error}`);
    });
  });

  try {
    await Promise.all([loadData(), loadLeaflet()]);
    createMap();
    updateHeader();
    setupAuth();
    requestAnimationFrame(() => map.invalidateSize());
  } catch (error) {
    console.error("No se pudo iniciar el mapa:", error);
    showLoadError("No se pudo cargar el mapa o los sitios. Revisa tu conexión e intenta recargar la página.");
  }
}

document.addEventListener("DOMContentLoaded", init);
