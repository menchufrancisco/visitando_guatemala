import json, re

def slug(s):
    s = s.lower().translate(str.maketrans("áéíóúñü", "aeiounu"))
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", s)).strip("-")[:45]

datos = json.load(open("sitios_guatemala.json", encoding="utf-8"))
mapa, usados = {}, set()

for dep, d in datos.items():
    for s in d["sitios"]:
        viejo = s["id"]
        nuevo = f"{dep}-{slug(s['nombre'])}"
        base, n = nuevo, 2
        while nuevo in usados:
            nuevo = f"{base}-{n}"; n += 1
        usados.add(nuevo)
        mapa[viejo] = nuevo
        s["id"] = nuevo

json.dump(datos, open("sitios_guatemala.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
json.dump(mapa, open("mapa_ids.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("Listo:", len(mapa), "ids convertidos. Mapa viejo->nuevo en mapa_ids.json")
