// Vista Plena — recoge titulares por RSS y los agrupa en historias.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const VENTANA_H = 48;

// ---------- RSS ----------
type Item = { titulo: string; url: string; resumen: string; publicado: Date; imagen?: string };

// Foto que el propio medio publica con la noticia (media:content, enclosure, image:loc o la primera <img>).
function imagenDe(b: string): string | undefined {
  const m = b.match(/<media:(?:content|thumbnail)[^>]*url="([^"]+\.(?:jpe?g|png|webp|gif)[^"]*)"/i)
    ?? b.match(/<media:(?:content|thumbnail)[^>]*medium="image"[^>]*url="([^"]+)"/i)
    ?? b.match(/<media:(?:content|thumbnail)[^>]*url="([^"]+)"[^>]*medium="image"/i)
    ?? b.match(/<enclosure[^>]*url="([^"]+\.(?:jpe?g|png|webp)[^"]*)"/i)
    ?? b.match(/<enclosure[^>]*type="image[^"]*"[^>]*url="([^"]+)"/i)
    ?? b.match(/<image:loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)/i)
    ?? decodeEntities(b).match(/<img[^>]*src="(https?:[^"]+)"/i);
  const u = m ? decodeEntities(m[1]).trim() : "";
  return u.startsWith("http") && !/\.(mp4|m3u8|mp3|webm|mov)(\?|$)/i.test(u) ? u : undefined;
}

function decodeEntities(s: string) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}
const strip = (s: string) => decodeEntities(decodeEntities(s)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
function tag(block: string, name: string) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1] : "";
}
function parse(xml: string): Item[] {
  const out: Item[] = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  for (const b of blocks) {
    const titulo = strip(tag(b, "title"));
    let url = strip(tag(b, "link"));
    if (!url) url = (b.match(/<link[^>]*href="([^"]+)"/i) ?? [])[1] ?? strip(tag(b, "guid"));
    const fecha = strip(tag(b, "pubDate") || tag(b, "dc:date") || tag(b, "published") || tag(b, "updated"));
    const resumen = strip(tag(b, "description") || tag(b, "summary") || tag(b, "content")).slice(0, 400);
    const d = fecha ? new Date(fecha) : new Date();
    if (titulo && url.startsWith("http")) out.push({ titulo, url, resumen, publicado: isNaN(+d) ? new Date() : d, imagen: imagenDe(b) });
  }
  if (!out.length) {
    // Sitemap de noticias de Google (<url> con <news:title>): lo usan medios sin RSS, como La Razón u Onda Cero.
    // Los sitemaps pueden traer más de mil entradas: con las 200 primeras (las más recientes) basta.
    for (const u of (xml.match(/<url>[\s\S]*?<\/url>/gi) ?? []).slice(0, 200)) {
      const titulo = strip(tag(u, "news:title"));
      const url = strip(tag(u, "loc"));
      const fecha = strip(tag(u, "news:publication_date") || tag(u, "lastmod"));
      const d = fecha ? new Date(fecha) : new Date();
      if (titulo && url.startsWith("http")) out.push({ titulo, url, resumen: "", publicado: isNaN(+d) ? new Date() : d, imagen: imagenDe(u) });
    }
  }
  return out;
}
// Portada en HTML: último recurso para medios sin RSS ni sitemap (p. ej. Público).
// Se toman los enlaces a noticias del propio dominio con un texto de titular razonable.
function parsePortada(html: string, base: string): Item[] {
  const host = new URL(base).host;
  const vistos = new Set<string>(), out: Item[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: string;
    try { url = new URL(m[1], base).href; } catch { continue; }
    if (new URL(url).host !== host || vistos.has(url)) continue;
    const titulo = strip(m[2]);
    if (titulo.length < 35 || titulo.length > 220 || !/[\/-]\d{3,}|\.html?$/.test(url)) continue;
    vistos.add(url);
    out.push({ titulo, url, resumen: "", publicado: new Date() });
    if (out.length >= 60) break;
  }
  return out;
}
// Algunos medios rechazan lectores desconocidos: si falla, se reintenta como navegador normal.
const AGENTES = ["Mozilla/5.0 (Vista Plena lector RSS)", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"];
async function leerUno(entrada: string): Promise<Item[]> {
  const esPortada = entrada.startsWith("html:");
  const rss = esPortada ? entrada.slice(5) : entrada;
  let ultimo = "";
  for (const ua of AGENTES) {
    const r = await fetch(rss, { headers: { "User-Agent": ua, "Accept": "application/rss+xml, application/xml, text/xml, */*" }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) { ultimo = `HTTP ${r.status}`; continue; }
    const buf = new Uint8Array(await r.arrayBuffer());
    const head = new TextDecoder("latin1").decode(buf.slice(0, 300));
    const cs = (r.headers.get("content-type")?.match(/charset=([\w-]+)/i) ?? head.match(/encoding="([\w-]+)"/i) ?? [])[1] ?? "utf-8";
    let txt: string;
    try { txt = new TextDecoder(cs.toLowerCase()).decode(buf); } catch { txt = new TextDecoder().decode(buf); }
    const items = esPortada ? parsePortada(txt, rss) : parse(txt);
    if (items.length) return items;
    ultimo = "sin noticias en el feed";
  }
  throw new Error(ultimo);
}
// Un medio puede tener varios canales (portada, política...) separados por espacios.
async function leer(rss: string): Promise<Item[]> {
  const urls = rss.split(/\s+/).filter(Boolean);
  const res = await Promise.allSettled(urls.map(leerUno));
  const items = res.flatMap((r) => r.status === "fulfilled" ? r.value : []);
  if (!items.length) throw (res.find((r) => r.status === "rejected") as PromiseRejectedResult)?.reason ?? new Error("sin noticias");
  const vistos = new Set<string>();
  return items.filter((i) => !vistos.has(i.url) && vistos.add(i.url));
}

// ---------- Palabras clave ----------
const VACIAS = new Set(("a al algo algun alguna algunas alguno algunos ante antes aqui asi aun aunque bajo bien cada casi como con contra cual cuales cuando de del desde donde dos el ella ellas ellos en entre era es esa ese eso esta este esto estos estas ha hace hacen hacia han hasta hay la las le les lo los mas me mi muy nada ni no nos nuestra o os otra otro otros para pero poco por porque que quien se ser si sin sino sobre son su sus tambien tan tanto te tiene tienen todo todos tras tu un una unas uno unos y ya yo " +
  "ultima hora directo video videos foto fotos claves asi dice dicen segun hoy ayer manana ano anos dia dias tras sera puede pueden quiere nuevo nueva nuevos gran grandes primer primera ultimo ultimos mejor mejores peor vez veces horas minutos solo cosas cosa forma hacer hecho tener esto estas despues mientras ademas entonces debe deben the of in and noticias espana espanol espanola " +
  "uno dos tres cuatro cinco seis siete ocho nueve diez once doce veinte treinta cien ciento mil millon millones persona personas detenido detenidos detenida detenidas detienen herido heridos herida heridas muere mueren muerto muertos muerta hombre hombres mujer mujeres joven jovenes vecino vecinos vecina grave graves anuncia nuevas otras").split(/\s+/));
function palabras(t: string): string[] {
  const norm = t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const set = new Set<string>();
  for (const w of norm.split(/[^a-z0-9]+/)) {
    if (!w || VACIAS.has(w)) continue;
    if (/^\d+$/.test(w) ? w.length < 2 : w.length < 4) continue;
    set.add(w.length > 6 ? w.slice(0, 6) : w); // raíz aproximada
  }
  return [...set];
}

// Secciones que no se recogen: ediciones locales de los medios nacionales (comparar su cobertura no tiene sentido
// y además multiplican los titulares de quien más ediciones tiene), opinión, y secciones de compras, virales o pasatiempos.
// Las secciones regionales colgadas de «España» (abc.es/espana/extremadura/…) sí se recogen: ahí van noticias
// de alcance nacional que ocurren en una región (p. ej. el caso de la jueza Biedma, en Badajoz).
const REGIONES = "emisoras|local|autonomias|c?madrid|comunidad-de-madrid|andalucia|sevilla|malaga|cordoba|" +
  "cataluna|catalunya|barcelona|comunidad-valenciana|comunitat-valenciana|valencia|castillayleon|castilla-y-leon|castilla-leon|castillalamancha|" +
  "castilla-la-mancha|toledo|aragon|galicia|euskadi|pais-vasco|bizkaia|gipuzkoa|murcia|region-de-murcia|baleares|illes-balears|canarias|asturias|" +
  "cantabria|navarra|extremadura|la-rioja|ceuta|melilla";
const SECCIONES = // opinión: son columnas y editoriales, no noticias
  "opinion|opiniones|editorial|editoriales|tribuna|tribunas|columnistas|blogs|cartas-al-director|" +
  "empresas-al-dia|patrocinado|contenido-patrocinado|branded|publirreportaje|comprar|compras|ofertas|videojuegos|tecnologia-consumo|curiosidades|virales|horoscopo|loterias?";
const FUERA = new RegExp(`^https?://[^/]+/(?:(?:es/)?(?:${REGIONES})|(?:es/|espana/)?(?:${SECCIONES}))(?:/|$)`, "i");

// ---------- Programa principal ----------
// El trabajo se hace en dos fases para no superar el límite de cálculo de cada ejecución:
// ?fase=leer descarga los titulares; ?fase=agrupar los junta en historias.
Deno.serve(async (req) => {
  const fase = new URL(req.url).searchParams.get("fase") ?? "todo";
  const informe: Record<string, string | number> = {};
  const { data: medios } = await db.from("medios").select("*").eq("activo", true);
  const desde = Date.now() - VENTANA_H * 3600e3;
  if (fase !== "agrupar" && fase !== "simular") {

  // 1. Leer feeds en paralelo
  await Promise.all((medios ?? []).map(async (m) => {
    try {
      // Como mucho 50 titulares por medio y lectura: así nadie pesa más por publicar más.
      // Se descartan las ediciones locales y las secciones de compras o pasatiempos (ver FUERA).
      const items = (await leer(m.rss)).filter((i) => +i.publicado >= desde && +i.publicado <= Date.now() + 3600e3 && !FUERA.test(i.url))
        .sort((x, y) => +y.publicado - +x.publicado).slice(0, 50);
      if (items.length) {
        await db.from("articulos").upsert(items.map((i) => ({
          medio_id: m.id, titulo: i.titulo, url: i.url, resumen: i.resumen || null,
          publicado: i.publicado.toISOString(), palabras: palabras(i.titulo + " " + i.resumen.slice(0, 160)), imagen: i.imagen ?? null,
        })), { onConflict: "url", ignoreDuplicates: true });
        // Completa la foto de artículos que ya teníamos guardados sin ella
        const conFoto = items.filter((i) => i.imagen).map((i) => ({ url: i.url, imagen: i.imagen }));
        if (conFoto.length) await db.rpc("poner_imagenes", { datos: conFoto });
      }
      await db.from("medios").update({ ultima_lectura: new Date().toISOString(), ultimo_error: null }).eq("id", m.id);
      informe[m.nombre] = items.length;
    } catch (e) {
      await db.from("medios").update({ ultimo_error: String(e).slice(0, 200) }).eq("id", m.id);
      informe[m.nombre] = "ERROR " + String(e).slice(0, 80);
    }
  }));
  if (fase === "leer") return new Response(JSON.stringify({ medios: informe }, null, 1), { headers: { "Content-Type": "application/json" } });
  }

  // 2. Agrupar artículos sin historia
  const desdeISO = new Date(desde).toISOString();
  // La API devuelve como mucho 1000 filas por petición: se pide por páginas.
  const recientes: any[] = [];
  for (let p = 0; p < 10; p++) {
    const { data } = await db.from("articulos").select("id, medio_id, historia_id, titulo, url, resumen, palabras, publicado")
      .gte("publicado", desdeISO).order("id").range(p * 1000, p * 1000 + 999);
    recientes.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  recientes.sort((x, y) => +new Date(x.publicado) - +new Date(y.publicado));
  // Para comparar se usan solo las palabras del titular: la entradilla mete palabras de contexto
  // («los favoritos», «el año pasado») que acercan noticias distintas. Si el titular tiene menos de 3, se usa lo guardado.
  const simular = fase === "simular", antigua = simular && new URL(req.url).searchParams.has("antigua"); // antigua: compara con el método anterior
  if (!antigua) for (const a of recientes) { const t = palabras(a.titulo); if (t.length >= 3) a.palabras = t; }
  if (simular) for (const a of recientes) a.historia_id = null;
  // Los directos ("en directo", "última hora") mezclan muchos temas: no se agrupan.
  const esDirecto = (t: string) => /(en directo|directo:|última hora|ultima hora|minuto a minuto|horóscopo|noticias de hoy|resumen de noticias|lotería|sorteo|el tiempo hoy)/i.test(t);
  const arts = recientes.filter((a) => !esDirecto(a.titulo) && a.palabras.length >= 3);
  const orient = new Map((medios ?? []).map((m) => [m.id, m.orientacion]));

  // Peso de cada palabra: las raras (nombres propios, temas concretos) cuentan más que las comunes.
  const df = new Map<string, number>();
  for (const a of arts) for (const w of a.palabras) df.set(w, (df.get(w) ?? 0) + 1);
  const N = arts.length || 1;
  const peso = (w: string) => Math.log((N + 1) / ((df.get(w) ?? 0) + 1));
  // Palabra «poco frecuente»: aparece en menos de 1 de cada 40 titulares recientes
  const RARA = Math.log((N + 1) / (N / 40 + 1));

  // Grupo = una historia. «ultimo»: hora del artículo más reciente. «padre»: la historia de la que se separó por traer un hecho nuevo.
  type Grupo = { id: number | null; palabras: Map<string, number>; ids: number[]; medios: Set<number>; primero: number; ultimo: number; padre: Grupo | null };
  const grupos = new Map<string, Grupo>();
  const grupoNuevo = (padre: Grupo | null = null): Grupo => ({ id: null, palabras: new Map(), ids: [], medios: new Set(), primero: Infinity, ultimo: 0, padre });
  // Índice palabra → grupos que la contienen: así cada artículo solo se compara con grupos que comparten alguna palabra.
  const indice = new Map<string, Set<Grupo>>();
  const anadir = (g: Grupo, a: any) => {
    for (const w of a.palabras) {
      g.palabras.set(w, (g.palabras.get(w) ?? 0) + 1);
      let s = indice.get(w); if (!s) indice.set(w, s = new Set()); s.add(g);
    }
    g.ids.push(a.id); g.medios.add(a.medio_id); g.ultimo = Math.max(g.ultimo, +new Date(a.publicado)); g.primero = Math.min(g.primero, +new Date(a.publicado));
  };
  for (const a of arts) if (a.historia_id) {
    const k = "h" + a.historia_id;
    let g = grupos.get(k);
    if (!g) { g = { ...grupoNuevo(), id: a.historia_id }; grupos.set(k, g); }
    anadir(g, a);
  }
  // Una historia solo admite titulares nuevos si se ha movido en las últimas 12 horas
  const VIVA = 12 * 3600e3;
  // Historia de la que salió cada artículo «con novedad»: si nadie más cuenta esa novedad, vuelve a ella
  const deDonde = new Map<number, Grupo>();
  let nuevos = 0, separados = 0;
  for (const a of arts) {
    if (a.historia_id) continue;
    const t = +new Date(a.publicado);
    const total = a.palabras.reduce((s: number, w: string) => s + peso(w), 0) || 1;
    const candidatos = new Set<Grupo>();
    for (const w of a.palabras) for (const g of indice.get(w) ?? []) candidatos.add(g);
    // Lo que el titular tiene en común con el grupo
    const parecido = (g: Grupo) => {
      // Solo cuentan las palabras que aparecen en al menos un 25 % de los artículos del grupo:
      // así una historia grande no se traga noticias vecinas que comparten una palabra suelta.
      const minimo = Math.max(1, Math.ceil(g.ids.length * 0.25));
      let comp = 0, n = 0, raras = 0;
      for (const w of a.palabras) if ((g.palabras.get(w) ?? 0) >= minimo) { comp += peso(w); n++; if (peso(w) >= RARA) raras++; }
      const score = comp / total;
      // Además tiene que compartir al menos una palabra poco frecuente (un nombre, un dato, un tema concreto):
      // dos titulares que solo coinciden en «PSOE» o «Gobierno» no tienen por qué hablar de lo mismo.
      return raras >= 1 && ((n >= 3 && score >= 0.4) || (n >= 2 && score >= 0.6)) ? score : 0;
    };
    let mejor: Grupo | null = null, mejorScore = 0;
    for (const g of candidatos) {
      if (!antigua && t - g.ultimo > VIVA) continue; // historia apagada
      const s = parecido(g);
      if (s > mejorScore) { mejor = g; mejorScore = s; }
    }
    // Lo que el titular trae de nuevo: palabras poco frecuentes (nombres, datos) que la historia no tenía.
    // Si trae dos o más, es otro hecho («Anne Carson gana el Nobel» frente a «los favoritos al Nobel»):
    // no entra en la historia vieja, sino en una nueva que queda enlazada a ella.
    // Solo se mira cuando la historia ya lleva 6 horas abierta: en las primeras horas, cada medio cuenta
    // el mismo hecho con palabras y detalles distintos, y separarlos partiría la noticia en trozos.
    if (!antigua && mejor && t - mejor.primero > 6 * 3600e3) {
      const novedad = a.palabras.filter((w: string) => peso(w) >= RARA && !mejor!.palabras.has(w)).length;
      if (novedad >= 2) {
        const viejo = mejor;
        let alt: Grupo | null = null, altScore = 0;
        // ¿Hay ya una historia joven (menos de 6 horas) o una que salió de esta con la misma novedad?
        for (const g of candidatos) if (g !== viejo && t - g.ultimo <= VIVA && (g.padre === viejo || t - g.primero <= 6 * 3600e3)) { const s = parecido(g); if (s > altScore) { alt = g; altScore = s; } }
        if (alt) { alt.padre ??= viejo; mejor = alt; }
        else { mejor = grupoNuevo(viejo); grupos.set("n" + a.id, mejor); nuevos++; }
        deDonde.set(a.id, viejo); separados++;
      }
    }
    if (!mejor) { mejor = grupoNuevo(); grupos.set("n" + a.id, mejor); nuevos++; }
    anadir(mejor, a);
  }

  const porId = new Map(arts.map((a) => [a.id, a]));
  // ?fase=simular: agrupa desde cero en memoria, sin guardar nada, y devuelve un informe para revisar el resultado
  if (simular) {
    const buscar = (new URL(req.url).searchParams.get("buscar") ?? "").split(",").filter(Boolean);
    const hora = (n: number) => new Date(n).toLocaleString("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    // Misma fusión que el paso 3b, hecha en memoria
    const vivos = [...grupos.values()].filter((g) => g.medios.size >= 2).sort((x, y) => y.ids.length - x.ids.length);
    const nuc = new Map(vivos.map((g) => [g, new Set([...g.palabras.entries()].filter(([, c]) => c >= Math.max(1, Math.ceil(g.ids.length * 0.25))).map(([w]) => w))]));
    const sum = (g: Grupo) => [...nuc.get(g)!].reduce((s, w) => s + peso(w), 0);
    const fuera = new Set<Grupo>(); let fus = 0;
    for (let i = 0; i < vivos.length; i++) {
      const A = vivos[i]; if (fuera.has(A)) continue;
      for (let j = i + 1; j < vivos.length; j++) {
        const B = vivos[j]; if (fuera.has(B)) continue;
        if (!antigua && (Math.abs(A.ultimo - B.ultimo) > VIVA || A.padre === B || B.padre === A)) continue;
        let comun = 0, n = 0, raras = 0;
        for (const w of nuc.get(A)!) if (nuc.get(B)!.has(w)) { comun += peso(w); n++; if (peso(w) >= RARA) raras++; }
        if (n >= 3 && raras >= 2 && comun / (Math.min(sum(A), sum(B)) || 1) >= 0.45) {
          A.ids.push(...B.ids); B.medios.forEach((m) => A.medios.add(m)); A.primero = Math.min(A.primero, B.primero); A.ultimo = Math.max(A.ultimo, B.ultimo);
          fuera.add(B); fus++;
        }
      }
    }
    const validos = vivos.filter((g) => !fuera.has(g));
    const ficha = (g: Grupo) => ({ titulos: g.ids.slice(0, 4).map((id) => porId.get(id)!.titulo).concat(g.ids.length > 4 ? [`… y ${g.ids.length - 4} más`] : []),
      medios: g.medios.size, desde: hora(g.primero), hasta: hora(g.ultimo), antes: g.padre ? porId.get(g.padre.ids[0])!.titulo : null });
    const informe2: Record<string, unknown> = { historias: validos.length, separados, fusiones: fus, abiertas_mas_de_12h: validos.filter((g) => g.ultimo - g.primero > VIVA).length };
    for (const b of buscar) { const k = palabras(b)[0]; informe2[b] = validos.filter((g) => g.palabras.has(k)).sort((x, y) => x.primero - y.primero).map(ficha); }
    return new Response(JSON.stringify(informe2, null, 1), { headers: { "Content-Type": "application/json" } });
  }

  // 3. Guardar: crear historias nuevas con 2+ medios y asignar artículos
  let asignados = 0, devueltos = 0;
  const devolver = new Map<number, number[]>();
  for (const g of grupos.values()) {
    const pendientes = g.ids.filter((id) => !porId.get(id)!.historia_id);
    if (!pendientes.length) continue;
    if (g.id === null && g.medios.size < 2) {
      // Espera a que otro medio la cuente. Si era una «novedad» que nadie más ha contado en 2 horas,
      // no era un hecho nuevo sino un detalle: vuelve a la historia de la que salió.
      for (const id of pendientes) {
        const v = deDonde.get(id);
        if (v?.id && Date.now() - +new Date(porId.get(id)!.publicado) > 2 * 3600e3) {
          const l = devolver.get(v.id) ?? []; l.push(id); devolver.set(v.id, l);
        }
      }
      continue;
    }
    // Titular: el que mejor resume lo que cuentan todos (el que más palabras clave del grupo contiene);
    // si hay empate, el del medio más cercano al centro y, después, el más antiguo.
    const minimoG = Math.max(1, Math.ceil(g.ids.length * 0.25));
    const cubre = (a: any) => Math.round(10 * a.palabras.reduce((s: number, w: string) => s + ((g.palabras.get(w) ?? 0) >= minimoG ? peso(w) : 0), 0)
      / (a.palabras.reduce((s: number, w: string) => s + peso(w), 0) || 1) * Math.min(1, a.palabras.length / 5));
    const lista = g.ids.map((id) => porId.get(id)!).sort((x, y) => cubre(y) - cubre(x) ||
      Math.abs(orient.get(x.medio_id) ?? 0) - Math.abs(orient.get(y.medio_id) ?? 0) || +new Date(x.publicado) - +new Date(y.publicado));
    const ref = lista[0];
    const top = [...g.palabras.entries()].sort((x, y) => y[1] - x[1]).slice(0, 40).map((e) => e[0]);
    if (g.id === null) {
      const { data } = await db.from("historias").insert({ titulo: ref.titulo, resumen: ref.resumen, palabras: top, anterior: g.padre?.id ?? null }).select("id").single();
      g.id = data!.id;
    } else {
      await db.from("historias").update({ titulo: ref.titulo, resumen: ref.resumen, palabras: top, actualizada: new Date().toISOString() }).eq("id", g.id);
    }
    await db.from("articulos").update({ historia_id: g.id }).in("id", pendientes);
    asignados += pendientes.length;
  }
  for (const [hid, ids] of devolver) {
    await db.from("articulos").update({ historia_id: hid }).in("id", ids);
    await db.from("historias").update({ actualizada: new Date().toISOString() }).eq("id", hid);
    devueltos += ids.length;
  }

  // 3b. Fusionar historias duplicadas (el mismo hecho contado con palabras distintas)
  const conId = [...grupos.values()].filter((g) => g.id !== null);
  // Parecido = peso de las palabras compartidas / peso de la historia con menos palabras
  const nucleo = (g: Grupo) => [...g.palabras.entries()].filter(([, c]) => c >= Math.max(1, Math.ceil(g.ids.length * 0.25))).map(([w]) => w);
  const nucleos = new Map(conId.map((g) => [g, new Set(nucleo(g))]));
  const suma = (g: Grupo) => [...nucleos.get(g)!].reduce((s, w) => s + peso(w), 0);
  const absorbido = new Set<Grupo>();
  let fusiones = 0;
  // Historias que se separaron a propósito (una continúa a la otra): nunca se vuelven a juntar
  const { data: enlaces } = await db.from("historias").select("id, anterior").not("anterior", "is", null).gte("actualizada", desdeISO);
  const separadas = new Set((enlaces ?? []).map((e: any) => e.id + "-" + e.anterior));
  for (const g of conId) if (g.padre?.id) separadas.add(g.id + "-" + g.padre.id);
  const hermanas = (x: Grupo, y: Grupo) => separadas.has(x.id + "-" + y.id) || separadas.has(y.id + "-" + x.id);
  conId.sort((x, y) => y.ids.length - x.ids.length);
  for (let i = 0; i < conId.length; i++) {
    const A = conId[i]; if (absorbido.has(A)) continue;
    for (let j = i + 1; j < conId.length; j++) {
      const B = conId[j]; if (absorbido.has(B)) continue;
      // Solo se juntan historias vivas a la vez (menos de 12 horas entre sus últimos titulares) y que no se separaron a propósito
      if (Math.abs(A.ultimo - B.ultimo) > VIVA || hermanas(A, B)) continue;
      // Solo se fusionan si comparten casi todo su núcleo (al menos 3 palabras clave y el 45 % de su peso)
      let comun = 0, n = 0, raras = 0;
      for (const w of nucleos.get(A)!) if (nucleos.get(B)!.has(w)) { comun += peso(w); n++; if (peso(w) >= RARA) raras++; }
      if (n >= 3 && raras >= 2 && comun / (Math.min(suma(A), suma(B)) || 1) >= 0.45) {
        await db.from("articulos").update({ historia_id: A.id }).eq("historia_id", B.id);
        await db.from("historias").delete().eq("id", B.id);
        absorbido.add(B); fusiones++; // A no amplía sus palabras: así no se encadenan fusiones
      }
    }
  }
  // 3c. Comprobación de puntos ciegos: antes de decir que un lado no cuenta una historia, se buscan titulares de ese lado
  // que hablen de lo mismo aunque hayan quedado en otra historia o sueltos (otro enfoque, otras palabras).
  // Se exige compartir al menos 3 palabras clave de la historia, 2 de ellas poco frecuentes, y estar a menos de 12 horas.
  const lado = (o: number) => (o < 0 ? "izq" : o > 0 ? "der" : "cen");
  const medioDe = new Map((medios ?? []).map((m) => [m.id, m]));
  const delLado: Record<string, any[]> = { izq: [], der: [] };
  for (const a of recientes) { const l = lado(orient.get(a.medio_id) ?? 0); if (l !== "cen" && a.palabras?.length >= 2) delLado[l].push(a); }
  const tambien: { id: number; tambien: unknown[] }[] = [];
  for (const g of conId) {
    if (absorbido.has(g) || Date.now() - g.ultimo > 36 * 3600e3) continue;
    // Lados «casi ausentes»: menos del 10 % de los medios de la historia (la misma regla que el punto ciego)
    const cuenta: Record<string, number> = { izq: 0, cen: 0, der: 0 };
    for (const m of g.medios) cuenta[lado(orient.get(m) ?? 0)]++;
    const lados = new Set(["izq", "der"].filter((l) => cuenta[l] >= 0.1 * g.medios.size));
    const nuc = nucleos.get(g)!, propios = new Set(g.ids), encontrados: any[] = [], yaMedio = new Set<number>();
    for (const L of ["izq", "der"]) {
      if (lados.has(L)) continue;
      for (const a of delLado[L]) {
        const t = +new Date(a.publicado);
        if (propios.has(a.id) || g.medios.has(a.medio_id) || yaMedio.has(a.medio_id) || t < g.primero - VIVA || t > g.ultimo + VIVA) continue;
        let n = 0, raras = 0;
        for (const w of a.palabras) if (nuc.has(w)) { n++; if (peso(w) >= RARA) raras++; }
        if (n >= 3 && raras >= 2) {
          const m = medioDe.get(a.medio_id);
          encontrados.push({ medio: m?.nombre, orientacion: m?.orientacion, titulo: a.titulo, url: a.url, publicado: a.publicado });
          yaMedio.add(a.medio_id);
        }
      }
    }
    tambien.push({ id: g.id!, tambien: encontrados });
  }
  if (tambien.length) await db.rpc("poner_tambien", { datos: tambien });

  // Los directos que se colaron antes salen de las historias
  const directos = recientes.filter((a) => (esDirecto(a.titulo) || a.palabras.length < 3) && a.historia_id).map((a) => a.id);
  if (directos.length) await db.from("articulos").update({ historia_id: null }).in("id", directos);

  // 4. Limpieza: borrar lo de hace más de 14 días
  const viejo = new Date(Date.now() - 14 * 864e5).toISOString();
  await db.from("articulos").delete().lt("publicado", viejo);
  await db.from("historias").delete().lt("actualizada", viejo);

  return new Response(JSON.stringify({ medios: informe, articulos_recientes: arts.length, grupos_nuevos: nuevos, asignados, separados, devueltos, fusiones }, null, 1),
    { headers: { "Content-Type": "application/json" } });
});
