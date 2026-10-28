import json, math, re, sys, time, urllib.parse, urllib.request

SERVIDORES = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

# id del proyecto -> (nombre, id de la relación en OpenStreetMap)
DEPTOS = {
    "peten": ("Petén", 214699), "altaverapaz": ("Alta Verapaz", 214695),
    "bajaverapaz": ("Baja Verapaz", 214712), "izabal": ("Izabal", 214705),
    "huehuetenango": ("Huehuetenango", 214708), "quiche": ("Quiché", 214700),
    "sanmarcos": ("San Marcos", 214707), "quetzaltenango": ("Quetzaltenango", 214710),
    "totonicapan": ("Totonicapán", 214709), "solola": ("Sololá", 214713),
    "chimaltenango": ("Chimaltenango", 214715), "sacatepequez": ("Sacatepéquez", 214703),
    "guatemala": ("Guatemala", 214704), "elprogreso": ("El Progreso", 214697),
    "zacapa": ("Zacapa", 214698), "chiquimula": ("Chiquimula", 214702),
    "jalapa": ("Jalapa", 214706), "jutiapa": ("Jutiapa", 214716),
    "santarosa": ("Santa Rosa", 9565597), "escuintla": ("Escuintla", 214714),
    "suchitepequez": ("Suchitepéquez", 214696), "retalhuleu": ("Retalhuleu", 214711),
}

SALIDA = "sitios_nuevos.json"
existentes = json.load(open("sitios_guatemala.json", encoding="utf-8"))


def norm(s):
    s = s.lower().translate(str.maketrans("áéíóúñü", "aeiounu"))
    return re.sub(r"[^a-z0-9]", "", s)


def km(a, b, c, d):
    p = math.pi / 180
    x = math.sin((c - a) * p / 2) ** 2 + math.cos(a * p) * math.cos(c * p) * math.sin((d - b) * p / 2) ** 2
    return 12742 * math.asin(math.sqrt(x))


def consulta(rel_id):
    # El área de una relación en Overpass es 3600000000 + id de la relación
    return f"""[out:json][timeout:90];
area({3600000000 + rel_id})->.a;
(
 nwr(area.a)["tourism"~"^(attraction|viewpoint|museum|zoo|theme_park)$"]["name"]["wikidata"];
 nwr(area.a)["historic"~"^(archaeological_site|ruins|monument|castle)$"]["name"]["wikidata"];
 nwr(area.a)["natural"~"^(waterfall|volcano|hot_spring|cave_entrance)$"]["name"];
);
out center tags;"""


def pedir(q):
    data = urllib.parse.urlencode({"data": q}).encode()
    for intento in range(2):
        for url in SERVIDORES:
            try:
                req = urllib.request.Request(url, data, {"User-Agent": "visitando-guatemala/1.0"})
                return json.load(urllib.request.urlopen(req, timeout=120))
            except Exception as e:
                print("  falló", url.split("/")[2], e, flush=True)
                time.sleep(3)
        time.sleep(10)
    return None


def procesar(dep, nombre, res):
    ya = existentes[dep]["sitios"]
    nombres_ya = {norm(s["nombre"]) for s in ya}
    lista, vistos = [], set()
    for el in res["elements"]:
        lat = el.get("lat") or el.get("center", {}).get("lat")
        lng = el.get("lon") or el.get("center", {}).get("lon")
        nom = el.get("tags", {}).get("name")
        if not (lat and lng and nom):
            continue
        if norm(nom) in nombres_ya or norm(nom) in vistos:
            continue
        if any(km(lat, lng, s["lat"], s["lng"]) < 0.3 for s in ya):
            continue
        vistos.add(norm(nom))
        lista.append({"id": f"{dep}-osm{el['type'][0]}{el['id']}", "nombre": nom,
                      "lat": round(lat, 5), "lng": round(lng, 5), "aprox": False})
    return {"departamento": nombre, "sitios": lista}


if __name__ == "__main__":
    # Uso: python3 importar_osm.py            -> todos
    #      python3 importar_osm.py solola     -> solo uno (para probar)
    pedidos = sys.argv[1:] or list(DEPTOS)
    try:
        nuevos = json.load(open(SALIDA, encoding="utf-8"))
    except FileNotFoundError:
        nuevos = {}

    for dep in pedidos:
        nombre, rel_id = DEPTOS[dep]
        if dep in nuevos:
            print(dep, "ya estaba, se salta")
            continue
        print(dep, "consultando...", flush=True)
        res = pedir(consulta(rel_id))
        if res is None:
            print(dep, "FALLÓ, se salta (volvé a correr para reintentar)")
            continue
        if not res.get("elements"):
            print(dep, "0 elementos: respuesta vacía (servidor saturado o sin datos). NO se guarda, reintentá más tarde.")
            continue
        nuevos[dep] = procesar(dep, nombre, res)
        print(dep, len(nuevos[dep]["sitios"]), "candidatos nuevos de", len(res["elements"]), "encontrados")
        json.dump(nuevos, open(SALIDA, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        time.sleep(5)

    print("Listo. Total candidatos:", sum(len(v["sitios"]) for v in nuevos.values()))