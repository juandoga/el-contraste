// Vista Plena — redes: publica en X, dos veces al día, una noticia con su imagen de cobertura.
//
//   ?tipo=manana   la noticia más contada de las últimas 12 h
//   ?tipo=tarde    la noticia de hoy con la cobertura más desigual (si no hay, la más contada)
//   &probar=1      no publica: devuelve el texto y la imagen que se usarían
//
// No pone enlaces en el texto (en X un post con enlace cuesta unas 13 veces más); la dirección va en la imagen y en el perfil.
// Nunca repite una noticia: lo publicado queda en la tabla redes_publicaciones.
// Claves (secretos de Supabase): X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET (OAuth 1.0a, permiso de lectura y escritura).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const WEB = "https://vistaplena.es";
const API = "https://api.x.com/2";
const K = {
  key: Deno.env.get("X_API_KEY") ?? "", secret: Deno.env.get("X_API_SECRET") ?? "",
  token: Deno.env.get("X_ACCESS_TOKEN") ?? "", tokenSecret: Deno.env.get("X_ACCESS_SECRET") ?? "",
};
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d, null, 1), { status, headers: { "Content-Type": "application/json" } });

// ---------- Firma OAuth 1.0a ----------
const pct = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
async function firma(metodo: string, url: string) {
  const u = new URL(url);
  const o: Record<string, string> = {
    oauth_consumer_key: K.key, oauth_nonce: crypto.randomUUID().replaceAll("-", ""), oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)), oauth_token: K.token, oauth_version: "1.0",
  };
  const params = [...Object.entries(o), ...u.searchParams.entries()].map(([k, v]) => [pct(k), pct(v)]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1);
  const base = [metodo, pct(u.origin + u.pathname), pct(params.map(([k, v]) => `${k}=${v}`).join("&"))].join("&");
  const clave = await crypto.subtle.importKey("raw", new TextEncoder().encode(`${pct(K.secret)}&${pct(K.tokenSecret)}`), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", clave, new TextEncoder().encode(base)))));
  o.oauth_signature = sig;
  return "OAuth " + Object.entries(o).map(([k, v]) => `${pct(k)}="${pct(v)}"`).join(", ");
}
async function llamar(metodo: string, url: string, cuerpo?: BodyInit, tipo?: string) {
  const headers: Record<string, string> = { Authorization: await firma(metodo, url) };
  if (tipo) headers["Content-Type"] = tipo;
  const r = await fetch(url, { method: metodo, headers, body: cuerpo });
  const t = await r.text();
  if (!r.ok) throw new Error(`X respondió ${r.status} en ${new URL(url).pathname}: ${t.slice(0, 400)}`);
  return t ? JSON.parse(t) : {};
}

// Sube una imagen PNG. Primero en una sola llamada; si X no la acepta, por partes (iniciar, añadir, terminar).
async function subirImagen(png: Uint8Array): Promise<string> {
  try {
    const f = new FormData();
    f.append("media", new Blob([png], { type: "image/png" }), "imagen.png");
    f.append("media_category", "tweet_image");
    f.append("media_type", "image/png");
    const r = await llamar("POST", `${API}/media/upload`, f);
    const id = r?.data?.id ?? r?.media_id_string;
    if (id) return String(id);
    throw new Error("sin id: " + JSON.stringify(r).slice(0, 200));
  } catch (e1) {
    const ini = await llamar("POST", `${API}/media/upload/initialize`, JSON.stringify({ media_type: "image/png", total_bytes: png.length, media_category: "tweet_image" }), "application/json");
    const id = String(ini?.data?.id ?? "");
    if (!id) throw new Error(`No se pudo subir la imagen (${e1}); tampoco por partes: ${JSON.stringify(ini).slice(0, 200)}`);
    const f = new FormData();
    f.append("segment_index", "0");
    f.append("media", new Blob([png], { type: "image/png" }), "imagen.png");
    await llamar("POST", `${API}/media/upload/${id}/append`, f);
    await llamar("POST", `${API}/media/upload/${id}/finalize`);
    return id;
  }
}

// ---------- Qué publicar ----------
const CAMPOS = "id,titulo,total,pct_izq,pct_cen,pct_der,punto_ciego,peso,creada,actualizada";
async function elegir(tipo: string) {
  const { data: hechas } = await db.from("redes_publicaciones").select("historia_id").eq("red", "x").gt("creado", new Date(Date.now() - 7 * 864e5).toISOString());
  const ya = new Set((hechas ?? []).map((x) => x.historia_id));
  // Solo noticias con más de una hora (así la web ya ha generado su imagen)
  const hace = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();
  const { data } = await db.from("portada_v2").select(CAMPOS).gt("actualizada", hace(tipo === "tarde" ? 16 : 12)).lt("creada", hace(1)).order("peso", { ascending: false }).limit(60);
  const libres = (data ?? []).filter((h) => !ya.has(h.id) && h.total >= 5);
  if (tipo === "tarde") {
    // Se alterna el lado con poca cobertura: si la última vez fue la izquierda, se busca primero una de la derecha.
    // Así la cuenta no parece señalar siempre al mismo lado (hay muchas más noticias con poca cobertura en la izquierda).
    const { data: ult } = await db.from("redes_publicaciones").select("lado").eq("red", "x").not("lado", "is", null).order("creado", { ascending: false }).limit(1);
    const preferido = ult?.[0]?.lado === "izquierda" ? "derecha" : "izquierda";
    const desiguales = libres.filter((h) => h.punto_ciego && h.total >= 8).sort((a, b) => b.total - a.total);
    const desigual = desiguales.find((h) => h.punto_ciego === preferido) ?? (ult?.[0]?.lado ? null : desiguales[0]);
    if (desigual) return { h: desigual, desigual: true };
  }
  return libres[0] ? { h: libres[0], desigual: false } : null;
}

function texto(h: any, desigual: boolean, tipo: string) {
  const titular = h.titulo.length > 150 ? h.titulo.slice(0, 147).replace(/\s+\S*$/, "") + "…" : h.titulo;
  const reparto = `${h.pct_izq} % izquierda · ${h.pct_cen} % centro · ${h.pct_der} % derecha`;
  const cab = desigual ? `Cobertura desigual: poca en la ${h.punto_ciego}.` : tipo === "manana" ? "Lo más contado esta mañana." : "Lo más contado hoy.";
  return `${cab}\n\n«${titular}»\n\nLa cuentan ${h.total} medios: ${reparto}.\n\nCómo la titula cada lado: enlace en el perfil.`;
}

Deno.serve(async (req) => {
  const q = new URL(req.url).searchParams;
  const tipo = q.get("tipo") === "tarde" ? "tarde" : "manana";
  const probar = q.get("probar") === "1";
  try {
    const elegida = await elegir(tipo);
    if (!elegida) return json({ ok: true, publicado: false, motivo: "No hay ninguna noticia nueva con 5 o más medios" });
    const { h, desigual } = elegida;
    const txt = texto(h, desigual, tipo);
    const imagen = `${WEB}/og/${h.id}.png`;
    if (probar) return json({ ok: true, prueba: true, historia: h.id, caracteres: txt.length, texto: txt, imagen });
    if (!K.key || !K.secret || !K.token || !K.tokenSecret) throw new Error("Faltan las claves de X en los secretos de Supabase");

    let media: string | null = null;
    const r = await fetch(imagen, { signal: AbortSignal.timeout(15000) });
    if (r.ok) media = await subirImagen(new Uint8Array(await r.arrayBuffer()));
    const post = await llamar("POST", `${API}/tweets`, JSON.stringify(media ? { text: txt, media: { media_ids: [media] } } : { text: txt }), "application/json");
    const id = post?.data?.id ?? null;
    await db.from("redes_publicaciones").insert({ red: "x", historia_id: h.id, tipo, lado: desigual ? h.punto_ciego : null, texto: txt, post_id: id });
    return json({ ok: true, publicado: true, historia: h.id, post: id, con_imagen: !!media, url: id ? `https://x.com/i/status/${id}` : null });
  } catch (e) {
    await db.from("redes_publicaciones").insert({ red: "x", historia_id: null, tipo, texto: null, error: String(e).slice(0, 500) });
    return json({ ok: false, error: String(e).slice(0, 500) }, 500);
  }
});
