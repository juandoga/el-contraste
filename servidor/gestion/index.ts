// Vista Plena — gestión privada: leer los avisos de error de los lectores y corregir temas a mano.
// Solo responde si la petición lleva la clave privada en la cabecera x-clave (se compara su huella SHA-256 con la guardada en la tabla privada «ajustes»).
//
// GET  ?q=avisos           avisos de los lectores, primero los pendientes, con el titular de la historia
// GET  ?q=temas            temas activos, con su nombre automático y el manual
// POST {accion:"revisar", id, revisado}
// POST {accion:"tema", id, nombre_manual, oculto}
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-clave", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const { data: aj } = await db.from("ajustes").select("valor").eq("nombre", "gestion_clave_sha256").single();
  const huella = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(req.headers.get("x-clave") ?? "")))).map((b) => b.toString(16).padStart(2, "0")).join("");
  if (!aj?.valor || huella !== aj.valor) return json({ error: "Clave incorrecta" }, 401);
  const q = new URL(req.url).searchParams.get("q");
  try {
    if (req.method === "GET" && q === "avisos") {
      const { data: avisos } = await db.from("reportes").select("*").order("revisado").order("creado", { ascending: false }).limit(300);
      const ids = [...new Set((avisos ?? []).map((a) => a.historia_id))];
      const titulos = new Map<number, string>();
      if (ids.length) {
        const { data: h } = await db.from("historias").select("id, titulo").in("id", ids);
        for (const x of h ?? []) titulos.set(x.id, x.titulo);
        const faltan = ids.filter((i) => !titulos.has(i));
        if (faltan.length) { const { data: a } = await db.from("archivo").select("historia_id, titulo").in("historia_id", faltan); for (const x of a ?? []) titulos.set(x.historia_id, x.titulo); }
      }
      return json((avisos ?? []).map((a) => ({ ...a, titulo: titulos.get(a.historia_id) ?? null })));
    }
    if (req.method === "GET" && q === "temas") {
      const { data } = await db.from("temas").select("id, nombre, nombre_manual, oculto, historias, actualizado").eq("activo", true).order("actualizado", { ascending: false });
      return json(data ?? []);
    }
    if (req.method === "POST") {
      const b = await req.json();
      if (b.accion === "revisar") {
        await db.from("reportes").update({ revisado: !!b.revisado }).eq("id", b.id);
        return json({ ok: true });
      }
      if (b.accion === "tema") {
        const nombre = String(b.nombre_manual ?? "").trim().slice(0, 80) || null;
        await db.from("temas").update({ nombre_manual: nombre, oculto: !!b.oculto }).eq("id", b.id);
        return json({ ok: true });
      }
    }
    return json({ error: "Petición desconocida" }, 400);
  } catch (e) {
    return json({ error: String(e).slice(0, 200) }, 500);
  }
});
