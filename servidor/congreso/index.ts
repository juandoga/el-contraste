// Vista Plena — congreso: descarga las votaciones del Pleno del Congreso (XV legislatura) de sus datos abiertos
// (https://www.congreso.es/opendata/votaciones) y guarda, para cada votación, qué votó cada partido.
//
// Cada llamada carga como mucho 6 días de pleno que aún no estén guardados (empezando por los más recientes),
// así que la primera vez hay que llamarla varias veces; después basta una vez al día.
// El Grupo Mixto se separa por partido (Podemos, BNG, Coalición Canaria, UPN…) con la lista oficial de diputados.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const WEB = "https://www.congreso.es";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const POR_LLAMADA = 6;

const texto = async (u: string) => {
  const r = await fetch(u, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} en ${u}`);
  return await r.text();
};
const pagina = (fecha?: string) => `${WEB}:443/es/opendata/votaciones?p_p_id=votaciones&p_p_lifecycle=0&p_p_state=normal&p_p_mode=view&targetLegislatura=XV` +
  (fecha ? `&targetDate=${fecha.slice(6, 8)}/${fecha.slice(4, 6)}/${fecha.slice(0, 4)}` : "");

// Grupo parlamentario → partido. El Mixto se resuelve diputado a diputado.
const GRUPOS: Record<string, string> = { GS: "PSOE", GP: "PP", GVOX: "Vox", GSUMAR: "Sumar", GR: "ERC", GJxCAT: "Junts", "GEH Bildu": "EH Bildu", "GV (EAJ-PNV)": "PNV" };
const grupo = (g: string) => GRUPOS[g] ?? (/bildu/i.test(g) ? "EH Bildu" : /PNV/i.test(g) ? "PNV" : g);
const normal = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

async function formaciones(): Promise<Map<string, string>> {
  // Lista oficial de diputados (activos y de baja): formación con la que se presentaron
  const html = await texto(`${WEB}/es/opendata/diputados`);
  const enlaces = [...html.matchAll(/href="(\/webpublica\/opendata\/diputados\/(?:DiputadosActivos|DiputadosDeBaja)__\d+\.json)"/g)].map((m) => WEB + m[1]);
  const mapa = new Map<string, string>();
  for (const u of enlaces) {
    const lista = JSON.parse(await texto(u));
    for (const d of lista) mapa.set(normal(d.NOMBRE), String(d.FORMACIONELECTORAL ?? ""));
  }
  return mapa;
}
// Partido de un diputado del Grupo Mixto. Los de Podemos se presentaron en la lista de Sumar.
function partidoMixto(nombre: string, formacion: string): string {
  const f = formacion.toUpperCase(), n = normal(nombre);
  if (/BNG/.test(f)) return "BNG";
  if (/^CC|\bCC\b|COALICI/.test(f)) return "CC";
  if (/UPN/.test(f)) return "UPN";
  if (/PSOE|PSC/.test(f)) return "Ábalos";
  if (/SUMAR/.test(f)) return n.startsWith("mico") ? "Compromís" : "Podemos";
  if (/VOX/.test(f)) return "Ex de Vox";
  if (/PP/.test(f)) return "Ex del PP";
  return "Mixto";
}

Deno.serve(async () => {
  // 1. Días con votaciones (la propia página los lista para su calendario)
  const portada = await texto(pagina());
  const dias = (portada.match(/var diasVotaciones\s*=\s*\[([^\]]*)\]/)?.[1] ?? "").split(",").map((s) => s.trim()).filter((s) => /^\d{8}$/.test(s));
  if (dias.length) await db.from("congreso_dias").upsert(dias.map((d) => ({ fecha: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` })), { onConflict: "fecha", ignoreDuplicates: true });
  const { data: pendientes } = await db.from("congreso_dias").select("fecha").is("cargado", null).order("fecha", { ascending: false }).limit(POR_LLAMADA);
  if (!pendientes?.length) return new Response(JSON.stringify({ dias: dias.length, pendientes: 0 }), { headers: { "Content-Type": "application/json" } });

  const forms = await formaciones();
  const informe: Record<string, number | string> = {};
  for (const { fecha } of pendientes) {
    try {
      const html = await texto(pagina(fecha.replaceAll("-", "")));
      const jsons = [...new Set([...html.matchAll(/href="(\/webpublica\/opendata\/votaciones\/Leg15\/[^"]+\/Votacion\d+\/VOT_\d+\.json)"/g)].map((m) => WEB + m[1]))];
      const filas: any[] = [];
      for (let i = 0; i < jsons.length; i += 6) {
        await Promise.all(jsons.slice(i, i + 6).map(async (u) => {
          const v = JSON.parse(await texto(u));
          const inf = v.informacion ?? {}, tot = v.totales ?? {};
          const partidos: Record<string, { si: number; no: number; abst: number; nv: number; voto?: string }> = {};
          for (const d of v.votaciones ?? []) {
            const p = d.grupo === "GMx" || /mixto/i.test(d.grupo) ? partidoMixto(d.diputado, forms.get(normal(d.diputado)) ?? "") : grupo(d.grupo);
            const x = partidos[p] ??= { si: 0, no: 0, abst: 0, nv: 0 };
            const voto = normal(String(d.voto));
            if (voto === "si") x.si++; else if (voto === "no") x.no++; else if (voto.startsWith("abst")) x.abst++; else x.nv++;
          }
          // Voto del partido: lo que votó la mayoría de sus diputados presentes
          for (const x of Object.values(partidos)) {
            const max = Math.max(x.si, x.no, x.abst);
            x.voto = max === 0 ? "No vota" : x.si === max ? "Sí" : x.no === max ? "No" : "Abstención";
          }
          filas.push({
            id: `${fecha}-${String(inf.numeroVotacion).padStart(3, "0")}`, fecha, sesion: inf.sesion, numero: inf.numeroVotacion,
            titulo: String(inf.titulo ?? "").trim(), expediente: String(inf.textoExpediente ?? "").trim(),
            subgrupo: String(inf.tituloSubGrupo ?? "").trim(), subgrupo_texto: String(inf.textoSubGrupo ?? "").trim(),
            asentimiento: tot.asentimiento === "Sí", presentes: tot.presentes, si: tot.afavor, no: tot.enContra, abst: tot.abstenciones,
            partidos, url: u,
          });
        }));
      }
      if (filas.length) await db.from("votaciones").upsert(filas, { onConflict: "id" });
      // Un día sin enlaces todavía (el Congreso los publica con retraso) se vuelve a intentar en la siguiente llamada
      if (filas.length) await db.from("congreso_dias").update({ cargado: new Date().toISOString(), votaciones: filas.length }).eq("fecha", fecha);
      informe[fecha] = filas.length;
    } catch (e) {
      informe[fecha] = "ERROR " + String(e).slice(0, 120);
    }
  }
  const { count } = await db.from("congreso_dias").select("fecha", { count: "exact", head: true }).is("cargado", null);
  return new Response(JSON.stringify({ dias: dias.length, cargados: informe, quedan: count }, null, 1), { headers: { "Content-Type": "application/json" } });
});
