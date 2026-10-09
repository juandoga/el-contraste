// Vista Plena — mantenimiento: copia de seguridad semanal y vigilancia de la recogida.
//
// ?tarea=copia    Copia todas las tablas en un archivo .json.gz y lo manda por correo a contacto@vistaplena.es
//                 (llega al correo personal del responsable; nunca se guarda en ningún sitio público,
//                 porque incluye las direcciones de los suscriptores del boletín).
// ?tarea=vigilar  Comprueba que todo funciona y, solo si hay algún problema, manda un aviso por correo:
//                 medios que llevan más de 6 horas sin leerse o con error, un lado que se queda con pocos medios,
//                 la recogida o la agrupación paradas.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const RESEND = Deno.env.get("RESEND_API_KEY") ?? "";
const DE = Deno.env.get("NEWSLETTER_FROM") ?? "Vista Plena <boletin@vistaplena.es>";
const PARA = "contacto@vistaplena.es";
const TABLAS = ["medios", "suscriptores", "envios", "reportes", "temas", "historias", "archivo", "articulos"];
const H = 3600e3;

async function correo(asunto: string, html: string, adjuntos: { filename: string; content: string }[] = []) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: DE, to: [PARA], subject: asunto, html, attachments: adjuntos }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
}

const fecha = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" }); // AAAA-MM-DD
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

async function copia() {
  const datos: Record<string, unknown[]> = {};
  const cuentas: string[] = [];
  for (const t of TABLAS) {
    const filas: unknown[] = [];
    for (let p = 0; p < 200; p++) {
      const { data, error } = await db.from(t).select("*").range(p * 1000, p * 1000 + 999);
      if (error) throw new Error(`${t}: ${error.message}`);
      filas.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    datos[t] = filas;
    cuentas.push(`<li>${t}: ${filas.length} filas</li>`);
  }
  // Comprimir con gzip y pasar a base64 para adjuntarlo
  const json = new TextEncoder().encode(JSON.stringify({ fecha: new Date().toISOString(), datos }));
  const gz = new Uint8Array(await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
  let bin = "";
  for (let i = 0; i < gz.length; i += 0x8000) bin += String.fromCharCode(...gz.subarray(i, i + 0x8000));
  const nombre = `vistaplena-copia-${fecha()}.json.gz`;
  await correo(`Vista Plena · copia de seguridad ${fecha()}`,
    `<p>Copia semanal de la base de datos de Vista Plena (${(gz.length / 1e6).toFixed(1)} MB comprimida).</p>
     <ul>${cuentas.join("")}</ul>
     <p>Guárdala en un sitio privado: incluye los correos de los suscriptores del boletín. No la compartas.</p>`,
    [{ filename: nombre, content: btoa(bin) }]);
  return { archivo: nombre, bytes: gz.length };
}

async function vigilar() {
  const avisos: string[] = [];
  const ahora = Date.now();
  // 1. Medios
  const { data: medios } = await db.from("medios").select("nombre, orientacion, ultima_lectura, ultimo_error").eq("activo", true);
  const lado = (o: number) => (o < 0 ? "izquierda" : o > 0 ? "derecha" : "centro");
  const total: Record<string, number> = { izquierda: 0, centro: 0, derecha: 0 }, sanos = { ...total };
  for (const m of medios ?? []) {
    total[lado(m.orientacion)]++;
    const parado = !m.ultima_lectura || ahora - +new Date(m.ultima_lectura) > 6 * H;
    if (parado || m.ultimo_error) {
      avisos.push(`<b>${esc(m.nombre)}</b> (${lado(m.orientacion)}): ${parado ? "más de 6 horas sin leerse" : "error al leer"}${m.ultimo_error ? ` · <code>${esc(m.ultimo_error).slice(0, 160)}</code>` : ""}`);
    } else sanos[lado(m.orientacion)]++;
  }
  // 2. Un lado con pocos medios funcionando tuerce los porcentajes
  for (const l of ["izquierda", "centro", "derecha"]) {
    if (total[l] && (total[l] - sanos[l] >= 2 || sanos[l] / total[l] < 0.8)) {
      avisos.push(`<b>El lado ${l} está cojo:</b> funcionan ${sanos[l]} de ${total[l]} medios. Los porcentajes de cobertura pueden estar torcidos.`);
    }
  }
  // 3. Recogida: el titular más reciente guardado
  const { data: ult } = await db.from("articulos").select("creado:publicado").order("id", { ascending: false }).limit(1);
  const { count: nuevos } = await db.from("articulos").select("id", { count: "exact", head: true }).gte("publicado", new Date(ahora - 3 * H).toISOString());
  if (!nuevos) avisos.push(`<b>La recogida parece parada:</b> no hay titulares de las últimas 3 horas${ult?.[0] ? ` (el último es de ${esc(ult[0].creado)})` : ""}.`);
  // 4. Agrupación: historias tocadas en las últimas 3 horas
  const { count: movidas } = await db.from("historias").select("id", { count: "exact", head: true }).gte("actualizada", new Date(ahora - 3 * H).toISOString());
  if (!movidas) avisos.push(`<b>La agrupación parece parada:</b> ninguna historia se ha actualizado en las últimas 3 horas.`);
  // 5. Temas
  const { count: temas } = await db.from("temas").select("id", { count: "exact", head: true }).eq("activo", true);
  if (!temas) avisos.push(`<b>No hay temas activos.</b> Puede que la función de temas esté fallando.`);

  if (avisos.length) {
    await correo(`Vista Plena · ${avisos.length} aviso${avisos.length > 1 ? "s" : ""}`,
      `<p>La revisión automática ha encontrado esto:</p><ul>${avisos.map((a) => `<li style="margin-bottom:8px">${a}</li>`).join("")}</ul>
       <p style="color:#777">Si es un medio suelto, suele arreglarse solo en la siguiente lectura. Si se repite, pide que lo revisemos.</p>`);
  }
  return { avisos: avisos.length, sanos, total };
}

Deno.serve(async (req) => {
  const tarea = new URL(req.url).searchParams.get("tarea");
  try {
    const r = tarea === "copia" ? await copia() : tarea === "vigilar" ? await vigilar() : { error: "tarea desconocida: usa ?tarea=copia o ?tarea=vigilar" };
    return new Response(JSON.stringify(r), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
