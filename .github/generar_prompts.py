import json, os

def cargar(ruta):
    try:
        return json.load(open(ruta, encoding="utf-8"))
    except FileNotFoundError:
        return {}

base = cargar("sitios_guatemala.json")
extras = [cargar(r) for r in ("sitios_nuevos.json", "sitios_gemini.json")]
os.makedirs("prompts", exist_ok=True)

for dep, datos in base.items():
    nombres = [s["nombre"] for s in datos["sitios"]]
    for e in extras:
        nombres += [s["nombre"] for s in e.get(dep, {}).get("sitios", [])]
    nombres = sorted(set(nombres))
    texto = f"""Departamento: {datos['departamento']} (Guatemala). departamento_id: {dep}

Dame sitios turísticos reales y visitables de este departamento que NO estén en la lista de abajo (miradores, sitios arqueológicos, cascadas, volcanes, lagos, parques, museos, aguas termales, cuevas, reservas, pueblos con valor turístico). Hasta 30 sitios.

Responde SOLO con filas CSV, sin encabezado, sin explicaciones, con este formato exacto:
{dep},Nombre del sitio

Solo el nombre oficial o más conocido, sin coordenadas. No inventes: si no estás seguro de que exista, no lo incluyas.

YA TENGO (no repetir):
""" + "\n".join(f"- {n}" for n in nombres) + "\n"
    open(f"prompts/{dep}.txt", "w", encoding="utf-8").write(texto)

print("Listo: 22 archivos en prompts/")