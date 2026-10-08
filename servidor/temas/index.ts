// Vista Plena — agrupa las historias de la última semana en TEMAS: asuntos concretos que duran varios días
// («Caso Leire», «Nobel de Literatura 2026»), con su cronología.
// Una historia es un hecho; un tema es la carpeta que reúne varios hechos relacionados, en orden.
//
// Cómo se decide (basado en Event Registry, Story Forest y USTORY):
// 1. De cada historia se sacan sus nombres propios (personas, lugares, organizaciones) y sus palabras clave.
// 2. Los nombres que salen en muchas historias de la semana («Sánchez», «PSOE», «Gobierno») pesan poco:
//    nunca bastan por sí solos para unir dos historias.
// 3. Una historia entra en un tema si comparte un nombre poco habitual con el tema y se parece, de media,
//    a sus últimas historias (no basta con parecerse a una sola: así no se encadenan temas sin fin).
// 4. Los temas se apagan si pasan 3 días sin historias nuevas, se vuelven más exigentes con la edad
//    y tienen un máximo de 30 historias.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const DIAS = 7, H = 3600e3;

// Palabras clave (las mismas reglas que la agrupación de historias)
const VACIAS = new Set(("a al algo algun alguna algunas alguno algunos ante antes aqui asi aun aunque bajo bien cada casi como con contra cual cuales cuando de del desde donde dos el ella ellas ellos en entre era es esa ese eso esta este esto estos estas ha hace hacen hacia han hasta hay la las le les lo los mas me mi muy nada ni no nos nuestra o os otra otro otros para pero poco por porque que quien se ser si sin sino sobre son su sus tambien tan tanto te tiene tienen todo todos tras tu un una unas uno unos y ya yo " +
  "ultima hora directo video videos foto fotos claves asi dice dicen segun hoy ayer manana ano anos dia dias tras sera puede pueden quiere nuevo nueva nuevos gran grandes primer primera ultimo ultimos mejor mejores peor vez veces horas minutos solo cosas cosa forma hacer hecho tener esto estas despues mientras ademas entonces debe deben the of in and noticias espana espanol espanola " +
  "uno dos tres cuatro cinco seis siete ocho nueve diez once doce veinte treinta cien ciento mil millon millones persona personas detenido detenidos detenida detenidas detienen herido heridos herida heridas muere mueren muerto muertos muerta hombre hombres mujer mujeres joven jovenes vecino vecinos vecina grave graves anuncia nuevas otras").split(/\s+/));
const sinTildes = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
function palabras(t: string): string[] {
  const set = new Set<string>();
  for (const w of sinTildes(t).split(/[^a-z0-9]+/)) {
    if (!w || VACIAS.has(w)) continue;
    if (/^\d+$/.test(w) ? w.length < 2 : w.length < 4) continue;
    set.add(w.length > 6 ? w.slice(0, 6) : w);
  }
  return [...set];
}

// Nombres propios por reglas: palabras con mayúscula que no abren la frase, y siglas (PP, PSOE, UCO).
// La primera palabra del titular solo cuenta si esa misma palabra aparece con mayúscula en mitad de otros titulares.
const NO_NOMBRE = new Set(("el la los las lo un una unos unas de del y e o u en por para con sin a al asi que como quien cual cuando donde este esta estos estas ese esa " +
  "su sus mi tu nuestro nuestra hoy ayer manana ultima ultimo nuevo nueva directo video claves todo todos lunes martes miercoles jueves viernes sabado domingo " +
  "enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre").split(" "));
type Trozo = { txt: string; norm: string; inicial: boolean; corta: boolean };
function trozos(titulo: string): Trozo[] {
  const out: Trozo[] = [];
  let inicial = true;
  for (const crudo of titulo.split(/\s+/)) {
    const abre = /^[«"'“¿¡(]/.test(crudo);
    const w = crudo.replace(/^[«"'“‘¿¡(\[]+|[»"'”’?!:;,.)\]…]+$/g, "");
    // «corta»: la palabra termina en coma, punto o comillas, así que no sigue el mismo nombre propio
    if (w) out.push({ txt: w, norm: sinTildes(w), inicial: inicial || abre, corta: /[,:;.?!»"”’…)]$/.test(crudo) });
    inicial = /[:.?!]$/.test(crudo);
  }
  return out;
}
const esSigla = (w: string) => /^[A-ZÁÉÍÓÚÑ]{2,6}$/.test(w);
const esMayus = (w: string) => /^[A-ZÁÉÍÓÚÑ][a-záéíóúñü]+(?:-[A-ZÁÉÍÓÚÑ]?[a-záéíóúñü]+)*$/.test(w) && w.length >= 3;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const simular = url.searchParams.get("fase") === "simular";
  const desde = new Date(Date.now() - DIAS * 24 * H).toISOString();

  // 1. Titulares de la última semana que ya están en una historia
  const arts: any[] = [];
  for (let p = 0; p < 40; p++) {
    const { data } = await db.from("articulos").select("historia_id, medio_id, titulo, publicado")
      .not("historia_id", "is", null).gte("publicado", desde).order("id").range(p * 1000, p * 1000 + 999);
    arts.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const hist: any[] = [];
  for (let p = 0; p < 20; p++) {
    const { data } = await db.from("historias").select("id, titulo, anterior, tema_id").gte("actualizada", desde).order("id").range(p * 1000, p * 1000 + 999);
    hist.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const infoH = new Map(hist.map((h) => [h.id, h]));

  // Palabras que aparecen con mayúscula en mitad de un titular (para validar la primera palabra)
  const mayusMedio = new Map<string, number>();
  for (const a of arts) for (const t of trozos(a.titulo)) if (!t.inicial && (esMayus(t.txt) || esSigla(t.txt))) mayusMedio.set(t.norm, (mayusMedio.get(t.norm) ?? 0) + 1);
  const esNombre = (t: Trozo) => !NO_NOMBRE.has(t.norm) && (esSigla(t.txt) || (esMayus(t.txt) && (!t.inicial || (mayusMedio.get(t.norm) ?? 0) >= 2)));

  // 2. Historias con su núcleo: nombres y palabras que están en al menos un 25 % de sus titulares
  type Hist = { id: number; titulo: string; ant: number | null; temaPrevio: number | null; medios: Set<number>; ini: number; fin: number; n: number;
    nombres: Set<string>; claves: Set<string>; frases: Map<string, number> };
  const porHist = new Map<number, { arts: any[] }>();
  for (const a of arts) { let x = porHist.get(a.historia_id); if (!x) porHist.set(a.historia_id, x = { arts: [] }); x.arts.push(a); }
  const H_: Hist[] = [];
  for (const [id, { arts: as }] of porHist) {
    const medios = new Set(as.map((a) => a.medio_id));
    if (medios.size < 3 || !infoH.has(id)) continue; // las mismas que se ven en la web
    const cuentaN = new Map<string, number>(), cuentaK = new Map<string, number>(), frases = new Map<string, number>();
    for (const a of as) {
      const ts = trozos(a.titulo);
      const vistosN = new Set<string>();
      // Frases de nombre propio («Anne Carson», «Premio Nobel de Literatura») para poner nombre al tema
      let actual: string[] = [];
      const cerrar = () => { if (actual.length) { const f = actual.join(" ").replace(/\s+(de|del|la|y)$/i, ""); frases.set(f, (frases.get(f) ?? 0) + 1); } actual = []; };
      ts.forEach((t, i) => {
        if (esNombre(t)) { vistosN.add(t.norm); actual.push(t.txt); if (t.corta) cerrar(); }
        else if (actual.length && /^(de|del|la)$/i.test(t.txt) && ts[i + 1] && esNombre(ts[i + 1])) actual.push(t.txt);
        else cerrar();
      });
      cerrar();
      vistosN.forEach((w) => cuentaN.set(w, (cuentaN.get(w) ?? 0) + 1));
      for (const w of palabras(a.titulo)) cuentaK.set(w, (cuentaK.get(w) ?? 0) + 1);
    }
    const min = Math.max(1, Math.ceil(as.length * 0.25));
    const tiempos = as.map((a) => +new Date(a.publicado));
    const h = infoH.get(id);
    H_.push({ id, titulo: h.titulo, ant: h.anterior, temaPrevio: h.tema_id, medios, n: as.length, ini: Math.min(...tiempos), fin: Math.max(...tiempos), frases,
      nombres: new Set([...cuentaN].filter(([, c]) => c >= min).map(([w]) => w)),
      claves: new Set([...cuentaK].filter(([, c]) => c >= min).map(([w]) => w)) });
  }
  H_.sort((a, b) => a.ini - b.ini);

  // 3. Peso de cada nombre y palabra según en cuántas historias de la semana sale
  const N = H_.length || 1;
  const dfN = new Map<string, number>(), dfK = new Map<string, number>();
  for (const h of H_) { h.nombres.forEach((w) => dfN.set(w, (dfN.get(w) ?? 0) + 1)); h.claves.forEach((w) => dfK.set(w, (dfK.get(w) ?? 0) + 1)); }
  const pesoK = (w: string) => Math.log((N + 1) / ((dfK.get(w) ?? 0) + 1));
  const pesoN = (w: string) => Math.log((N + 1) / ((dfN.get(w) ?? 0) + 1));
  // Nombre «comodín»: los que salen en todo (Sánchez, PSOE, Gobierno, EEUU…) o en más del 10 % de las historias de la semana.
  // Nunca bastan por sí solos para unir dos historias.
  const COMODINES = new Set("sanchez pedro gobierno espana madrid psoe pp vox sumar feijoo estado eeuu trump ue union europea barcelona cataluna junta real congreso presidente".split(" "));
  const comodin = (w: string) => COMODINES.has(w) || (dfN.get(w) ?? 0) > Math.max(6, N * 0.10);

  // Parecido entre dos historias: palabras clave compartidas, ponderadas (0 a 1)
  const parecido = (a: Hist, b: Hist) => {
    let comun = 0, total = 0;
    for (const w of a.claves) { const p = pesoK(w); total += p; if (b.claves.has(w)) comun += p; }
    for (const w of b.claves) if (!a.claves.has(w)) total += pesoK(w);
    return total ? comun / total : 0;
  };
  // Enlace: al menos un nombre poco habitual en común, y dos nombres o tres palabras en común
  const enlazan = (a: Hist, b: Hist) => {
    let raros = 0, nombres = 0, claves = 0;
    for (const w of a.nombres) if (b.nombres.has(w)) { nombres++; if (!comodin(w)) raros++; }
    for (const w of a.claves) if (b.claves.has(w)) claves++;
    return raros >= 1 && (nombres >= 2 || claves >= 3);
  };

  // 4. Recorrido en orden de llegada
  type Tema = { hs: Hist[]; ini: number; fin: number; nombres: Map<string, number> };
  const temas: Tema[] = [];
  const temaDe = new Map<number, Tema>();
  const meter = (t: Tema, h: Hist) => { t.hs.push(h); t.fin = Math.max(t.fin, h.ini); h.nombres.forEach((w) => t.nombres.set(w, (t.nombres.get(w) ?? 0) + 1)); temaDe.set(h.id, t); };
  const sueltas: Hist[] = [];
  for (const h of H_) {
    // Si esta historia continúa otra (regla de «hecho nuevo»), va al tema de aquella
    const previa = h.ant ? temaDe.get(h.ant) : undefined;
    if (previa && previa.hs.length < 30) { meter(previa, h); continue; }
    let mejor: Tema | null = null, mejorP = 0;
    for (const t of temas) {
      if (t.hs.length >= 30 || h.ini - t.fin > 72 * H) continue; // lleno o apagado
      // Debe compartir un nombre poco habitual con el núcleo del tema (nombres en al menos el 40 % de sus historias)
      const nucleo = [...t.nombres].filter(([w, c]) => !comodin(w) && c >= Math.max(1, t.hs.length * 0.4)).map(([w]) => w);
      if (!nucleo.some((w) => h.nombres.has(w))) continue;
      const ultimas = t.hs.slice(-5);
      if (!ultimas.some((u) => enlazan(h, u))) continue;
      const media = ultimas.reduce((s, u) => s + parecido(h, u), 0) / ultimas.length;
      // Más exigente con la edad: +0,02 por cada día a partir del tercero
      const edad = (h.ini - t.ini) / (24 * H);
      if (media < 0.12 + Math.max(0, edad - 3) * 0.02) continue;
      if (media > mejorP) { mejor = t; mejorP = media; }
    }
    if (mejor) { meter(mejor, h); continue; }
    // Si no, busca pareja entre las historias sueltas de los últimos 3 días
    let par: Hist | null = null, parP = 0;
    for (const s of sueltas) {
      if (h.ini - s.ini > 72 * H || temaDe.has(s.id) || !enlazan(h, s)) continue;
      const p = parecido(h, s);
      if (p >= 0.2 && p > parP) { par = s; parP = p; }
    }
    if (par) {
      const t: Tema = { hs: [], ini: par.ini, fin: par.ini, nombres: new Map() };
      meter(t, par); meter(t, h); temas.push(t);
    } else sueltas.push(h);
  }

  // 4b. Unir temas del mismo protagonista: si dos temas a la vez (menos de 3 días entre ellos) tienen el mismo nombre
  // poco habitual en al menos la mitad de sus historias («Maricarmen»), son el mismo tema contado por partes
  const clave = (t: Tema) => new Set([...t.nombres].filter(([w, c]) => !comodin(w) && c >= t.hs.length * 0.5).map(([w]) => w));
  temas.sort((a, b) => b.hs.length - a.hs.length);
  for (let i = 0; i < temas.length; i++) {
    for (let j = i + 1; j < temas.length; j++) {
      const A = temas[i], B = temas[j];
      if (A.hs.length + B.hs.length > 30) continue;
      if (Math.max(A.ini, B.ini) - Math.min(A.fin, B.fin) > 72 * H) continue;
      const kA = clave(A);
      if (![...clave(B)].some((w) => kA.has(w))) continue;
      // Y al menos una historia de cada uno tiene que enlazar con otra del otro (un país en común, como «Rusia», no basta)
      if (!A.hs.some((x) => B.hs.some((y) => enlazan(x, y)))) continue;
      for (const h of B.hs) meter(A, h);
      A.ini = Math.min(A.ini, B.ini); A.hs.sort((x, y) => x.ini - y.ini);
      temas.splice(j, 1); j--;
    }
  }

  // 5. Nombre del tema: la frase de nombre propio más repetida y más distintiva («Anne Carson», «Leire Díez»)
  const nombrar = (t: Tema) => {
    const cuenta = new Map<string, number>();
    for (const h of t.hs) for (const [f, c] of h.frases) cuenta.set(f, (cuenta.get(f) ?? 0) + c);
    let mejor = "", mejorP = 0;
    for (const [f, c] of cuenta) {
      const ws = trozos(f).map((x) => x.norm).filter((w) => !NO_NOMBRE.has(w));
      if (!ws.length || ws.every(comodin)) continue;
      const enHistorias = t.hs.filter((h) => ws.some((w) => h.nombres.has(w))).length;
      const p = c * (enHistorias / t.hs.length) * (ws.reduce((s, w) => s + pesoN(w), 0) / ws.length) * Math.min(1.3, 1 + 0.15 * (ws.length - 1));
      if (p > mejorP) { mejor = f; mejorP = p; }
    }
    return mejor.replace(/^(El|La|Los|Las)\s+/, "") || t.hs[t.hs.length - 1].titulo.split(/[:,]/)[0];
  };

  // 5b. Dos temas activos con el mismo nombre son el mismo tema: se unen
  const nombreDe = new Map<Tema, string>(temas.map((t) => [t, nombrar(t)]));
  for (let i = 0; i < temas.length; i++) {
    for (let j = i + 1; j < temas.length; j++) {
      const A = temas[i], B = temas[j];
      if (nombreDe.get(A) !== nombreDe.get(B) || A.hs.length + B.hs.length > 30) continue;
      if (Math.max(A.ini, B.ini) - Math.min(A.fin, B.fin) > 72 * H) continue;
      for (const h of B.hs) meter(A, h);
      A.ini = Math.min(A.ini, B.ini); A.hs.sort((x, y) => x.ini - y.ini);
      temas.splice(j, 1); j--;
      nombreDe.set(A, nombrar(A));
    }
  }

  const hora = (n: number) => new Date(n).toLocaleString("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  if (simular) {
    const lista = temas.sort((a, b) => b.hs.length - a.hs.length).map((t) => ({ nombre: nombreDe.get(t), historias: t.hs.length,
      desde: hora(t.ini), hasta: hora(t.fin), titulares: t.hs.map((h) => `${hora(h.ini)} · ${h.medios.size} · ${h.titulo.slice(0, 90)}`) }));
    const comodines = [...dfN].filter(([w]) => comodin(w)).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([w, c]) => `${w} ${c}`);
    return new Response(JSON.stringify({ historias: N, en_temas: temaDe.size, temas: temas.length, comodines, lista }, null, 1), { headers: { "Content-Type": "application/json" } });
  }

  // 6. Guardar. Cada tema conserva su número si la mayoría de sus historias ya estaban en él.
  const usados = new Set<number>();
  let creados = 0;
  const ordenados = [...temas].sort((a, b) => b.hs.length - a.hs.length);
  for (const t of ordenados) {
    const votos = new Map<number, number>();
    for (const h of t.hs) if (h.temaPrevio) votos.set(h.temaPrevio, (votos.get(h.temaPrevio) ?? 0) + 1);
    const [previo, n] = [...votos].filter(([id]) => !usados.has(id)).sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
    const fila = { nombre: nombreDe.get(t)!, inicio: new Date(t.ini).toISOString(), actualizado: new Date(Math.max(...t.hs.map((h) => h.fin))).toISOString(), historias: t.hs.length, activo: true };
    let id: number;
    if (previo && n >= t.hs.length / 2) { id = previo; await db.from("temas").update(fila).eq("id", id); }
    else { const { data } = await db.from("temas").insert(fila).select("id").single(); id = data!.id; creados++; }
    usados.add(id);
    const cambiar = t.hs.filter((h) => h.temaPrevio !== id).map((h) => h.id);
    if (cambiar.length) await db.from("historias").update({ tema_id: id }).in("id", cambiar);
  }
  // Historias de la semana que ya no están en ningún tema
  const quitar = H_.filter((h) => h.temaPrevio && !temaDe.has(h.id)).map((h) => h.id);
  for (let i = 0; i < quitar.length; i += 200) await db.from("historias").update({ tema_id: null }).in("id", quitar.slice(i, i + 200));
  // Temas que se han quedado sin historias o llevan 7 días sin moverse
  await db.from("temas").update({ activo: false }).lt("actualizado", desde);
  const vivos = [...usados];
  if (vivos.length) await db.from("temas").update({ activo: false }).eq("activo", true).not("id", "in", `(${vivos.join(",")})`).gte("actualizado", desde);

  return new Response(JSON.stringify({ historias: N, en_temas: temaDe.size, temas: temas.length, creados, quitadas: quitar.length }, null, 1),
    { headers: { "Content-Type": "application/json" } });
});
