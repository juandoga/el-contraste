#!/usr/bin/env python3
"""Vista Plena — genera, cada hora, las páginas que leen los buscadores y las redes sociales.

La web normal es dinámica: historia.html?id=123 pide los datos al abrirse. Google la puede leer, pero WhatsApp, X o
Telegram no ejecutan código, así que al compartir una noticia solo verían el título genérico. Este programa crea:

- /noticia/<titulo>-<id>/   una página por noticia de los últimos 14 días, con el contenido ya escrito, su título,
                            su descripción, su imagen para redes y sus datos estructurados (schema.org)
- /tema/<nombre>-<id>/      lo mismo para cada tema
- /og/<id>.png              la imagen para redes de cada noticia reciente: titular + reparto izquierda/centro/derecha
- /sitemap.xml y /robots.txt
- /estilos/*.css            los estilos, en un archivo aparte para que cada página pese poco

Uso: python seo/generar.py _site   (copia la web a _site y añade lo generado). Si Supabase no responde,
la web se publica igual, sin las páginas generadas.
"""
import datetime as dt
import hashlib
import html
import json
import os
import re
import shutil
import sys
import unicodedata
import urllib.request

SUPA = "https://yzreenyaerjitbfxsiah.supabase.co"
KEY = "sb_publishable_1As_Elit5MJVUOZFOLeDjA_YMVv6jjF"  # clave pública de solo lectura
BASE = "https://vistaplena.es"
DIAS = 14          # noticias con página propia
OG_HORAS = 72      # noticias con imagen propia para redes (las demás usan la genérica)
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SALIDA = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "_site")
NO_COPIAR = {".git", ".github", "seo", "servidor", "README.md", "_site"}
CAMPOS = ("id,creada,titulo,total,voces,izq,cen,der,imagen,imagen_medio,pct_izq,pct_cen,pct_der,punto_ciego,"
          "actualizada,articulos,entradilla,entradilla_medio,tema_id")
MESES = "enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre".split()
fecha = lambda iso: (lambda d: f"{d.day} de {MESES[d.month - 1]}")(dt.datetime.fromisoformat(iso.replace("Z", "+00:00")))
ETIQUETA = {-2: "Izquierda", -1: "Centroizquierda", 0: "Centro", 1: "Centroderecha", 2: "Derecha"}
esc = lambda s: html.escape(str(s or ""), quote=True)


def slug(t):
    """La misma regla que slug() en comun.js: si cambia una, debe cambiar la otra."""
    s = unicodedata.normalize("NFD", str(t or "").lower())
    s = "".join(c for c in s if not ("̀" <= c <= "ͯ"))
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    if len(s) > 70:
        s = s[:70]
        if "-" in s:
            s = s[:s.rfind("-")]
    return s.rstrip("-") or "noticia"


url_noticia = lambda id_, t: f"/noticia/{slug(t)}-{id_}/"
url_tema = lambda id_, n: f"/tema/{slug(n)}-{id_}/"


def pedir(ruta):
    req = urllib.request.Request(f"{SUPA}/rest/v1/{ruta}", headers={"apikey": KEY, "Authorization": "Bearer " + KEY})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def todo(ruta):
    filas, n = [], 0
    while True:
        lote = pedir(f"{ruta}&limit=500&offset={n}")
        filas += lote
        if len(lote) < 500:
            return filas
        n += 500


def copiar_web():
    if os.path.exists(SALIDA):
        shutil.rmtree(SALIDA)
    os.makedirs(SALIDA)
    for nombre in os.listdir(RAIZ):
        if nombre in NO_COPIAR or nombre.startswith("."):
            continue
        origen = os.path.join(RAIZ, nombre)
        (shutil.copytree if os.path.isdir(origen) else shutil.copy2)(origen, os.path.join(SALIDA, nombre))


def plantilla(nombre):
    """Lee historia.html o tema.html, saca sus estilos a un archivo y añade <base href="/"> para que las rutas
    relativas (fuentes, scripts) funcionen desde /noticia/…/"""
    t = open(os.path.join(SALIDA, nombre), encoding="utf-8").read()
    css = re.search(r"<style>(.*?)</style>", t, re.S).group(1).replace("url(fuentes/", "url(/fuentes/")
    archivo = f"estilos/{nombre.split('.')[0]}-{hashlib.md5(css.encode()).hexdigest()[:8]}.css"
    os.makedirs(os.path.join(SALIDA, "estilos"), exist_ok=True)
    open(os.path.join(SALIDA, archivo), "w", encoding="utf-8").write(css)
    t = re.sub(r"<style>.*?</style>", f'<link rel="stylesheet" href="/{archivo}">', t, count=1, flags=re.S)
    return t.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<base href="/">', 1)


def montar(t, *, titulo, desc, url, imagen, tipo, jsonld, id_, cuerpo):
    meta = lambda prop, valor: f'<meta property="{prop}" content="{esc(valor)}">'
    # (las sustituciones van con lambda para que una barra invertida en un titular no se interprete)
    t = re.sub(r"<title>.*?</title>", lambda _: f"<title>{esc(titulo)}</title>", t, count=1)
    t = re.sub(r'<meta name="description" content="[^"]*">', lambda _: f'<meta name="description" content="{esc(desc)}">', t, count=1)
    for prop, valor in (("og:type", tipo), ("og:title", titulo), ("og:description", desc), ("og:url", BASE + url), ("og:image", imagen)):
        t = re.sub(rf'<meta property="{prop}" content="[^"]*">', lambda _: meta(prop, valor), t, count=1)
    t = t.replace('<meta name="robots" content="noindex,follow">',
                  f'<link rel="canonical" href="{BASE}{url}">\n'
                  f'<meta name="twitter:title" content="{esc(titulo)}">\n<meta name="twitter:description" content="{esc(desc)}">\n'
                  f'<meta name="twitter:image" content="{esc(imagen)}">\n'
                  f'<script type="application/ld+json">{json.dumps(jsonld, ensure_ascii=False)}</script>', 1)
    t = t.replace("<body>", f'<body data-id="{id_}">', 1)
    return re.sub(r'<article id="art"[^>]*>.*?</article>', lambda _: f'<article id="art" aria-live="polite">{cuerpo}</article>', t, count=1, flags=re.S)


def escribir(url, contenido):
    ruta = os.path.join(SALIDA, url.strip("/"), "index.html")
    os.makedirs(os.path.dirname(ruta), exist_ok=True)
    open(ruta, "w", encoding="utf-8").write(contenido)


lado = lambda o: "izq" if o < 0 else "der" if o > 0 else "cen"


def lectura(h):
    if h["punto_ciego"] == "izquierda":
        return "Punto ciego de la izquierda: casi ningún medio de izquierdas la cuenta."
    if h["punto_ciego"] == "derecha":
        return "Punto ciego de la derecha: casi ningún medio de derechas la cuenta."
    d = h["pct_izq"] - h["pct_der"]
    if d >= 20:
        return "La cuentan más los medios de izquierdas."
    if d <= -20:
        return "La cuentan más los medios de derechas."
    return "Cobertura repartida entre izquierda, centro y derecha."


def por_medio(h):
    """El titular más reciente de cada medio, primero lo último"""
    vistos, out = set(), []
    for a in sorted(h["articulos"] or [], key=lambda a: a.get("publicado") or "", reverse=True):
        if a["medio"] not in vistos:
            vistos.add(a["medio"])
            out.append(a)
    return out


def descripcion(h):
    base = (f"La cuentan {h['total']} medios: izquierda {h['pct_izq']} %, centro {h['pct_cen']} %, derecha {h['pct_der']} %. "
            f"{lectura(h)} Así la titula cada lado.")
    return base[:300]


def cuerpo_noticia(h, tema):
    m = por_medio(h)
    n = {k: sum(1 for a in m if lado(a["orientacion"]) == k) for k in ("izq", "cen", "der")}
    nombres = {"izq": "Izquierda", "cen": "Centro", "der": "Derecha"}
    bloques = ""
    for k in ("izq", "cen", "der"):
        lista = [a for a in m if lado(a["orientacion"]) == k]
        items = "".join(
            f'<li><span class="medio">{esc(a["medio"])} <span class="ficha">{ETIQUETA[a["orientacion"]]}</span></span>'
            f'<a href="{esc(a["url"])}" target="_blank" rel="noopener">{esc(a["titulo"])}</a></li>' for a in lista)
        bloques += (f'<div class="bloque"><div class="lado eti">{nombres[k]} · {len(lista)}</div>'
                    + (f"<ul>{items}</ul>" if lista else '<p class="vacio">Ningún medio de este lado la ha publicado.</p>') + "</div>")
    ent = (f'<section class="hist-que"><h2>Qué ha pasado</h2><blockquote>{esc(h["entradilla"])}</blockquote>'
           f'<p class="aparte">Entradilla de {esc(h["entradilla_medio"])}.</p></section>') if h.get("entradilla") else ""
    tema_html = (f'<p class="hilo"><span><b>Tema:</b> <a href="{url_tema(tema["id"], tema["nombre"])}">{esc(tema["nombre"])}</a></span></p>') if tema else ""
    return (f'<header class="hist-cab"><h1>{esc(h["titulo"])}</h1>'
            f'<div class="meta"><span>{h["total"]} medios · {h["voces"]} voces</span></div>{tema_html}</header>'
            f'<div class="hist-cuerpo"><div class="hist-izq">{ent}'
            f'<section class="hist-cob"><h2>Quién la cuenta</h2><p class="resumen">{esc(lectura(h))}</p>'
            f'<p class="cuenta">La publican <b>{h["total"]} medios</b>: {n["izq"]} de izquierda o centroizquierda, {n["cen"]} de centro '
            f'y {n["der"]} de derecha o centroderecha. Reparto: izquierda {h["pct_izq"]} %, centro {h["pct_cen"]} %, derecha {h["pct_der"]} %.</p>'
            f'</section></div><section class="hist-asi"><h2>Así la titula cada lado</h2>{bloques}</section></div>')


def jsonld_noticia(h, url, imagen, tema):
    migas = [{"@type": "ListItem", "position": 1, "name": "Portada", "item": BASE + "/"}]
    if tema:
        migas.append({"@type": "ListItem", "position": 2, "name": tema["nombre"], "item": BASE + url_tema(tema["id"], tema["nombre"])})
    migas.append({"@type": "ListItem", "position": len(migas) + 1, "name": h["titulo"], "item": BASE + url})
    return {"@context": "https://schema.org", "@graph": [
        {"@type": "WebPage", "@id": BASE + url, "url": BASE + url, "name": h["titulo"], "description": descripcion(h),
         "inLanguage": "es-ES", "datePublished": h["creada"], "dateModified": h["actualizada"],
         "isPartOf": {"@id": BASE + "/#web"}, "publisher": {"@id": BASE + "/#organizacion"},
         "primaryImageOfPage": {"@type": "ImageObject", "url": imagen},
         # Las noticias originales que se comparan en esta página
         "citation": [{"@type": "NewsArticle", "headline": a["titulo"], "url": a["url"], "datePublished": a.get("publicado"),
                       "publisher": {"@type": "Organization", "name": a["medio"]}} for a in por_medio(h)[:40]]},
        {"@type": "BreadcrumbList", "itemListElement": migas}]}


# ---------- Imagen para redes: titular y reparto de la cobertura ----------
FUENTES = {}


def fuentes():
    """Convierte las fuentes de la web (woff2) a ttf para poder dibujar con ellas"""
    if FUENTES:
        return FUENTES
    from fontTools.ttLib import TTFont
    os.makedirs("/tmp/vp-fuentes", exist_ok=True)
    for clave, archivo in {"titular": "newsreader-latin-opsz-normal", "negra": "roboto-latin-900-normal",
                           "media": "roboto-latin-500-normal", "num": "roboto-mono-latin-500-normal"}.items():
        destino = f"/tmp/vp-fuentes/{archivo}.ttf"
        if not os.path.exists(destino):
            f = TTFont(os.path.join(RAIZ, "fuentes", archivo + ".woff2"))
            f.flavor = None
            f.save(destino)
        FUENTES[clave] = destino
    return FUENTES


def imagen_og(h, ruta):
    from PIL import Image, ImageDraw, ImageFont
    F = fuentes()
    W, H = 1200, 630
    TINTA, FONDO, GRIS = (17, 18, 19), (255, 255, 255), (122, 126, 134)
    IZQ, CEN, DER = (192, 57, 43), (179, 181, 185), (44, 90, 160)
    im = Image.new("RGB", (W, H), FONDO)
    d = ImageDraw.Draw(im)
    # Logo: esquinas roja y azul y punto
    x0, y0, s = 64, 52, 40
    g = max(4, s // 9)
    d.line([(x0, y0 + s * 0.62), (x0, y0 + s), (x0 + s * 0.38, y0 + s)], fill=IZQ, width=g, joint="curve")
    d.line([(x0 + s * 0.62, y0), (x0 + s, y0), (x0 + s, y0 + s * 0.38)], fill=DER, width=g, joint="curve")
    r = s * 0.16
    d.ellipse([x0 + s / 2 - r, y0 + s / 2 - r, x0 + s / 2 + r, y0 + s / 2 + r], fill=TINTA)
    d.text((x0 + s + 16, y0 + s / 2), "Vista Plena", font=ImageFont.truetype(F["negra"], 34), fill=TINTA, anchor="lm")
    d.text((W - 64, y0 + s / 2), "Quién cuenta esta noticia", font=ImageFont.truetype(F["media"], 24), fill=GRIS, anchor="rm")
    # Titular en serif, en hasta 4 líneas, bajando el tamaño si hace falta
    for tam in (66, 60, 54, 48, 44):
        fuente = ImageFont.truetype(F["titular"], tam)
        try:
            fuente.set_variation_by_axes([600, 48])  # peso y tamaño óptico de Newsreader
        except Exception:
            pass
        lineas, actual = [], ""
        for palabra in h["titulo"].split():
            prueba = (actual + " " + palabra).strip()
            if d.textlength(prueba, font=fuente) <= W - 128:
                actual = prueba
            else:
                lineas.append(actual)
                actual = palabra
        lineas.append(actual)
        if len(lineas) <= 4:
            break
    if len(lineas) > 4:
        lineas = lineas[:4]
        lineas[-1] = lineas[-1].rstrip(".,;:") + "…"
    y = 150
    for l in lineas:
        d.text((64, y), l, font=fuente, fill=TINTA)
        y += int(tam * 1.12)
    # Barra de cobertura
    yb, hb = H - 150, 52
    total = max(1, h["pct_izq"] + h["pct_cen"] + h["pct_der"])
    x = 64
    num = ImageFont.truetype(F["num"], 26)
    for pct, col, txt in ((h["pct_izq"], IZQ, FONDO), (h["pct_cen"], CEN, TINTA), (h["pct_der"], DER, FONDO)):
        ancho = (W - 128) * pct / total
        if ancho > 0:
            d.rounded_rectangle([x, yb, x + ancho - 3, yb + hb], radius=6, fill=col)
            if ancho > 90:
                d.text((x + 16, yb + hb / 2), f"{pct} %", font=num, fill=txt, anchor="lm")
        x += ancho
    pie = ImageFont.truetype(F["media"], 26)
    d.text((64, yb + hb + 24), "Izquierda", font=pie, fill=IZQ)
    d.text((W / 2, yb + hb + 24), "Centro", font=pie, fill=GRIS, anchor="ma")
    d.text((W - 64, yb + hb + 24), "Derecha", font=pie, fill=DER, anchor="ra")
    resumen = f"La cuentan {h['total']} medios" + (f" · punto ciego de la {h['punto_ciego']}" if h["punto_ciego"] else "")
    d.text((64, yb - 22), resumen, font=pie, fill=TINTA, anchor="ls")
    im.save(ruta, optimize=True)


# ---------- Programa principal ----------
def main():
    copiar_web()
    open(os.path.join(SALIDA, "robots.txt"), "w").write(f"User-agent: *\nAllow: /\n\nSitemap: {BASE}/sitemap.xml\n")
    ahora = dt.datetime.now(dt.timezone.utc)
    desde = (ahora - dt.timedelta(days=DIAS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        if os.environ.get("VP_DATOS"):  # pruebas sin conexión: un JSON con {"historias": [...], "temas": [...]}
            datos = json.load(open(os.environ["VP_DATOS"]))
            historias, temas = datos["historias"], datos["temas"]
        else:
          historias = todo(f"portada_v2?select={CAMPOS}&creada=gt.{desde}&order=id")
          temas = todo(f"temas?select=id,nombre,inicio,actualizado,historias,activo&actualizado=gt.{desde}&historias=gte.2&order=id")
    except Exception as e:
        print("Supabase no responde; se publica la web sin páginas generadas:", e)
        return
    temas = {t["id"]: t for t in temas}
    tpl_h, tpl_t = plantilla("historia.html"), plantilla("tema.html")
    os.makedirs(os.path.join(SALIDA, "og"), exist_ok=True)
    mapa = []
    con_og = 0
    for h in historias:
        url = url_noticia(h["id"], h["titulo"])
        tema = temas.get(h.get("tema_id"))
        imagen = BASE + "/og.png"
        creada = dt.datetime.fromisoformat(h["creada"].replace("Z", "+00:00"))
        if (ahora - creada).total_seconds() < OG_HORAS * 3600:
            try:
                imagen_og(h, os.path.join(SALIDA, "og", f"{h['id']}.png"))
                imagen = f"{BASE}/og/{h['id']}.png"
                con_og += 1
            except Exception as e:
                print("Sin imagen para", h["id"], e)
        escribir(url, montar(tpl_h, titulo=f"{h['titulo']} · Vista Plena", desc=descripcion(h), url=url, imagen=imagen,
                             tipo="article", jsonld=jsonld_noticia(h, url, imagen, tema), id_=h["id"], cuerpo=cuerpo_noticia(h, tema)))
        mapa.append((url, h["actualizada"]))
    # Temas
    por_tema = {}
    for h in historias:
        if h.get("tema_id") in temas:
            por_tema.setdefault(h["tema_id"], []).append(h)
    for tid, hs in por_tema.items():
        t = temas[tid]
        hs.sort(key=lambda x: x["creada"], reverse=True)
        url = url_tema(tid, t["nombre"])
        desc = f"{len(hs)} noticias sobre {t['nombre']}, en orden, y quién cuenta cada una: izquierda, centro y derecha."
        lista = "".join(f'<li><time datetime="{h["creada"]}">{fecha(h["creada"])}</time><div><a href="{url_noticia(h["id"], h["titulo"])}">'
                        f'{esc(h["titulo"])}</a><span class="m">{h["total"]} medios · izquierda {h["pct_izq"]} %, centro {h["pct_cen"]} %, '
                        f'derecha {h["pct_der"]} %</span></div></li>' for h in hs)
        cuerpo = (f'<header class="hist-cab"><div class="hist-etis"><span class="tema-eti">Tema</span></div><h1>{esc(t["nombre"])}</h1>'
                  f'<p class="tema-sub">{len(hs)} noticia{"s" if len(hs) != 1 else ""} desde el {fecha(hs[-1]["creada"])}</p></header><section class="tema-crono"><h2>Cronología</h2>'
                  f'<div class="tc-dia"><ol>{lista}</ol></div></section>')
        jsonld = {"@context": "https://schema.org", "@graph": [
            {"@type": "CollectionPage", "@id": BASE + url, "url": BASE + url, "name": t["nombre"], "description": desc, "inLanguage": "es-ES",
             "dateModified": t["actualizado"], "isPartOf": {"@id": BASE + "/#web"}, "publisher": {"@id": BASE + "/#organizacion"},
             "mainEntity": {"@type": "ItemList", "itemListElement": [
                 {"@type": "ListItem", "position": i + 1, "url": BASE + url_noticia(h["id"], h["titulo"]), "name": h["titulo"]} for i, h in enumerate(hs)]}},
            {"@type": "BreadcrumbList", "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": "Portada", "item": BASE + "/"},
                {"@type": "ListItem", "position": 2, "name": t["nombre"], "item": BASE + url}]}]}
        escribir(url, montar(tpl_t, titulo=f"{t['nombre']}: todas las noticias, en orden · Vista Plena", desc=desc, url=url,
                             imagen=BASE + "/og.png", tipo="website", jsonld=jsonld, id_=tid, cuerpo=cuerpo))
        mapa.append((url, t["actualizado"]))
    # Mapa del sitio y robots.txt
    fijas = [("/", ahora.isoformat()), ("/metodologia.html", None), ("/elecciones.html", None), ("/quienes-somos.html", None),
             ("/?vista=ciegos", ahora.isoformat())]
    xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for url, mod in fijas + mapa:
        xml.append(f"<url><loc>{esc(BASE + url)}</loc>" + (f"<lastmod>{mod[:19]}+00:00</lastmod>" if mod else "") + "</url>")
    xml.append("</urlset>")
    open(os.path.join(SALIDA, "sitemap.xml"), "w", encoding="utf-8").write("\n".join(xml))
    print(f"{len(historias)} noticias, {len(por_tema)} temas, {con_og} imágenes para redes")


if __name__ == "__main__":
    main()
