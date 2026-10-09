// Vista Plena — portadas: lee cada hora la portada web de cada medio y guarda sus primeros titulares, en orden.
//
// Para qué sirve:
// 1. Saber qué destaca cada medio. Los canales RSS dan todo por orden de hora (el canal «portada» de ABC trae
//    suplementos de magnesio y series de Netflix); la portada web dice qué considera importante el periódico.
//    Una historia que abre muchas portadas sube en Vista Plena aunque cada uno la titule distinto.
// 2. Recoger noticias que no salen en los canales: si un titular de portada no está en la base de datos,
//    se guarda como artículo para que entre en la agrupación (paso siguiente, a los minutos 12).
//
// ?fase=probar devuelve los 5 primeros titulares de cada medio sin guardar nada.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CUANTOS = 15; // titulares de portada que se guardan por medio
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

function decodeEntities(s: string) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}
const strip = (s: string) => decodeEntities(s).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const normal = (u: string) => u.replace(/[?#].*$/, "").replace(/\/$/, "");

// Las mismas exclusiones que la recogida (servidor/recoger): ediciones locales, opinión, compras, pasatiempos.
const REGIONES = "emisoras|local|autonomias|c?madrid|comunidad-de-madrid|andalucia|sevilla|malaga|cordoba|" +
  "cataluna|catalunya|barcelona|comunidad-valenciana|comunitat-valenciana|valencia|castillayleon|castilla-y-leon|castilla-leon|castillalamancha|" +
  "castilla-la-mancha|toledo|aragon|galicia|euskadi|pais-vasco|bizkaia|gipuzkoa|murcia|region-de-murcia|baleares|illes-balears|canarias|asturias|" +
  "cantabria|navarra|extremadura|la-rioja|ceuta|melilla";
const SECCIONES = "opinion|opiniones|editorial|editoriales|tribuna|tribunas|columnistas|blogs|cartas-al-director|" +
  "empresas-al-dia|patrocinado|contenido-patrocinado|branded|publirreportaje|comprar|compras|ofertas|videojuegos|tecnologia-consumo|curiosidades|virales|horoscopo|loterias?";
const FUERA = new RegExp(`^https?://[^/]+/(?:(?:es/)?(?:${REGIONES})|(?:es/|espana/)?(?:${SECCIONES}))(?:/|$)`, "i");

// Palabras clave del titular (las mismas reglas que la recogida)
const VACIAS = new Set(("a al algo algun alguna algunas alguno algunos ante antes aqui asi aun aunque bajo bien cada casi como con contra cual cuales cuando de del desde donde dos el ella ellas ellos en entre era es esa ese eso esta este esto estos estas ha hace hacen hacia han hasta hay la las le les lo los mas me mi muy nada ni no nos nuestra o os otra otro otros para pero poco por porque que quien se ser si sin sino sobre son su sus tambien tan tanto te tiene tienen todo todos tras tu un una unas uno unos y ya yo " +
  "ultima hora directo video videos foto fotos claves asi dice dicen segun hoy ayer manana ano anos dia dias tras sera puede pueden quiere nuevo nueva nuevos gran grandes primer primera ultimo ultimos mejor mejores peor vez veces horas minutos solo cosas cosa forma hacer hecho tener esto estas despues mientras ademas entonces debe deben the of in and noticias espana espanol espanola " +
  "uno dos tres cuatro cinco seis siete ocho nueve diez once doce veinte treinta cien ciento mil millon millones persona personas detenido detenidos detenida detenidas detienen herido heridos herida heridas muere mueren muerto muertos muerta hombre hombres mujer mujeres joven jovenes vecino vecinos vecina grave graves anuncia nuevas otras").split(/\s+/));
function palabras(t: string): string[] {
  const norm = t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const set = new Set<string>();
  for (const w of norm.split(/[^a-z0-9]+/)) {
    if (!w || VACIAS.has(w)) continue;
    if (/^\d+$/.test(w) ? w.length < 2 : w.length < 4) continue;
    set.add(w.length > 6 ? w.slice(0, 6) : w);
  }
  return [...set];
}

// Titulares de portada, en el orden en que aparecen: enlaces dentro de un título (h1, h2, h3) a una noticia del propio medio.
// Si la portada no usa títulos, se toman los enlaces con texto de titular y dirección de noticia.
type Tit = { titulo: string; url: string };
function leerPortada(html: string, base: string): Tit[] {
  const host = new URL(base).host.replace(/^www\./, "");
  const out: Tit[] = [], vistos = new Set<string>();
  const anadir = (href: string, texto: string) => {
    let url: string;
    try { url = new URL(decodeEntities(href), base).href; } catch { return; }
    const u = new URL(url);
    if (!u.host.replace(/^www\./, "").endsWith(host) || FUERA.test(url)) return;
    // Dirección de noticia: con número, terminada en .html o con un nombre largo (no secciones como /espana/)
    if (!/\d{4,}|\.html?$|\/[a-z0-9]+(?:-[a-z0-9]+){4,}\/?$/i.test(u.pathname)) return;
    const titulo = strip(texto);
    if (titulo.length < 25 || titulo.length > 250) return;
    // Fuera etiquetas y antetítulos («ELECCIONES GENERALES 2026», «Conciertos gratis Hispanidad»): un titular tiene al menos 6 palabras y no va todo en mayúsculas
    const letras = titulo.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñü]/g, "");
    if (titulo.split(/\s+/).length < 6 || letras.replace(/[^A-ZÁÉÍÓÚÑ]/g, "").length > letras.length * 0.6) return;
    if (/^(directo|en directo|v[ií]deo|encuesta|lee la edici[oó]n)\b/i.test(titulo)) return;
    const k = normal(url);
    if (vistos.has(k)) return;
    vistos.add(k); out.push({ titulo, url });
  };
  // Se quitan menús, cabecera y pie, donde hay enlaces que no son titulares
  const cuerpo = html.replace(/<(nav|footer|header|script|style|noscript)\b[\s\S]*?<\/\1>/gi, " ");
  for (const m of cuerpo.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi)) {
    const a = m[1].match(/<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (a) anadir(a[1], a[2]);
    if (out.length >= CUANTOS) break;
  }
  if (out.length < 5) {
    for (const m of cuerpo.matchAll(/<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
      anadir(m[1], m[2]);
      if (out.length >= CUANTOS) break;
    }
  }
  return out.slice(0, CUANTOS);
}

async function descargar(url: string): Promise<string> {
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "text/html,*/*", "Accept-Language": "es-ES,es;q=0.9" }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const buf = new Uint8Array(await r.arrayBuffer());
  const head = new TextDecoder("latin1").decode(buf.slice(0, 2000));
  const cs = (r.headers.get("content-type")?.match(/charset=([\w-]+)/i) ?? head.match(/charset="?([\w-]+)/i) ?? [])[1] ?? "utf-8";
  try { return new TextDecoder(cs.toLowerCase()).decode(buf); } catch { return new TextDecoder().decode(buf); }
}

Deno.serve(async (req) => {
  const probar = new URL(req.url).searchParams.get("fase") === "probar";
  const { data: medios } = await db.from("medios").select("id, nombre, web").eq("activo", true);
  const informe: Record<string, unknown> = {};
  let nuevos = 0;
  // De 6 en 6 para no saturar
  const lista = [...(medios ?? [])].filter((m) => m.web);
  for (let i = 0; i < lista.length; i += 6) {
    await Promise.all(lista.slice(i, i + 6).map(async (m) => {
      try {
        const tits = leerPortada(await descargar(m.web), m.web);
        if (probar) { informe[m.nombre] = tits.slice(0, 5).map((t) => t.titulo.slice(0, 90)); return; }
        if (!tits.length) { informe[m.nombre] = 0; return; }
        const ahora = new Date().toISOString();
        await db.from("portadas").delete().eq("medio_id", m.id);
        await db.from("portadas").insert(tits.map((t, k) => ({ medio_id: m.id, posicion: k + 1, titulo: t.titulo, url: t.url, url_norm: normal(t.url), leido: ahora })));
        // Titulares de portada que no estaban en la base de datos: se guardan como artículos
        const { data: ya } = await db.from("articulos").select("url").in("url", tits.map((t) => t.url));
        const tenemos = new Set((ya ?? []).map((a: any) => normal(a.url)));
        const { data: yaN } = await db.rpc("articulos_por_url_norm", { urls: tits.map((t) => normal(t.url)) });
        for (const r of yaN ?? []) tenemos.add(r.url_norm);
        const faltan = tits.filter((t) => !tenemos.has(normal(t.url)));
        if (faltan.length) {
          await db.from("articulos").upsert(faltan.map((t) => ({ medio_id: m.id, titulo: t.titulo, url: t.url, resumen: null, publicado: ahora, palabras: palabras(t.titulo), imagen: null })),
            { onConflict: "url", ignoreDuplicates: true });
          nuevos += faltan.length;
        }
        informe[m.nombre] = tits.length;
      } catch (e) {
        informe[m.nombre] = "ERROR " + String(e).slice(0, 80);
      }
    }));
  }
  return new Response(JSON.stringify({ medios: informe, nuevos }, null, 1), { headers: { "Content-Type": "application/json" } });
});
