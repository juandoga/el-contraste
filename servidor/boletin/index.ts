// Vista Plena — boletín diario por correo con Resend.
// Rutas (?accion=): alta (formulario de la web), confirmar y baja (enlaces del correo), enviar (programado cada mañana).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const RESEND = Deno.env.get("RESEND_API_KEY") ?? "";
const DE = Deno.env.get("NEWSLETTER_FROM") ?? "Vista Plena <onboarding@resend.dev>";
const WEB = "https://vistaplena.es/";
const FUNC = `${Deno.env.get("SUPABASE_URL")}/functions/v1/boletin`;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, authorization, apikey", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };

const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const volver = (estado: string) => new Response(null, { status: 302, headers: { Location: `${WEB}?boletin=${estado}#boletin` } });
const esc = (s: string) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

async function enviarCorreos(lista: { to: string; subject: string; html: string; baja?: string }[]) {
  if (!RESEND) throw new Error("Falta la clave RESEND_API_KEY en los secretos de Supabase");
  let ok = 0;
  for (let i = 0; i < lista.length; i += 100) {
    const lote = lista.slice(i, i + 100).map((c) => ({
      from: DE, to: [c.to], subject: c.subject, html: c.html,
      headers: c.baja ? { "List-Unsubscribe": `<${c.baja}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : undefined,
    }));
    const r = await fetch("https://api.resend.com/emails/batch", {
      method: "POST", headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" }, body: JSON.stringify(lote),
    });
    if (!r.ok) throw new Error(`Resend respondió ${r.status}: ${(await r.text()).slice(0, 300)}`);
    ok += lote.length;
  }
  return ok;
}

// ---------- Plantillas de correo ----------
const COL = { izq: "#c0392b", cen: "#b3b5b9", der: "#2c5aa0" };
function barra(h: any) {
  const celda = (p: number, c: string) => p > 0 ? `<td width="${p}%" style="background:${c};height:8px;font-size:0;line-height:0">&nbsp;</td>` : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:4px;overflow:hidden"><tr>${celda(h.pct_izq, COL.izq)}${celda(h.pct_cen, COL.cen)}${celda(h.pct_der, COL.der)}</tr></table>`;
}
function porLado(h: any) {
  const lado = (o: number) => o < 0 ? "izq" : o > 0 ? "der" : "cen";
  const uno: Record<string, any> = {};
  for (const a of h.articulos ?? []) { const k = lado(a.orientacion); if (!uno[k]) uno[k] = a; }
  const fila = (k: string, n: string) => uno[k]
    ? `<tr><td style="padding:3px 0;font:13px/1.4 Arial,sans-serif;color:#555"><span style="color:${(COL as any)[k]};font-weight:bold">●</span> <b style="color:#333">${n}</b> · ${esc(uno[k].medio)}: <a href="${esc(uno[k].url)}" style="color:#111">${esc(uno[k].titulo)}</a></td></tr>` : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${fila("izq", "Izquierda")}${fila("cen", "Centro")}${fila("der", "Derecha")}</table>`;
}
function pieza(h: any, n: number) {
  const ciego = h.punto_ciego ? `<span style="font:bold 11px Arial,sans-serif;color:#b26b00;text-transform:uppercase;letter-spacing:.06em">Punto ciego de la ${h.punto_ciego}</span><br>` : "";
  const foto = h.imagen ? `<img src="${esc(h.imagen)}" width="560" alt="" style="width:100%;max-width:560px;height:auto;border-radius:8px;display:block;margin:0 0 12px">` : "";
  return `<tr><td style="padding:22px 0;border-top:1px solid #e6e6e3">
    ${n === 1 ? foto : ""}
    <div style="font:12px Arial,sans-serif;color:#888;margin-bottom:6px">${n} · ${h.total} medios</div>
    ${ciego}
    <div style="font:bold 20px/1.25 Georgia,serif;color:#111;margin:4px 0 12px">${esc(h.titulo)}</div>
    ${barra(h)}
    <div style="font:12px Arial,sans-serif;color:#888;margin:6px 0 10px">Izquierda ${h.pct_izq} % · Centro ${h.pct_cen} % · Derecha ${h.pct_der} %</div>
    ${porLado(h)}
  </td></tr>`;
}
function correoDiario(top: any[], ciegos: any[], fecha: string, baja: string) {
  return `<!doctype html><html lang="es"><body style="margin:0;background:#f4f4f2">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f2"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px"><tr><td style="padding:28px 28px 8px">
    <div style="font:900 26px Arial,sans-serif;letter-spacing:-1px;color:#111">Vista Plena.</div>
    <div style="font:13px Arial,sans-serif;color:#888;margin-top:4px">Resumen del ${esc(fecha)}</div>
    <p style="font:15px/1.5 Arial,sans-serif;color:#3d4047;margin:16px 0 0">Las ${top.length} historias que más medios contaron ayer, con quién las contó y cómo las tituló cada lado.</p>
  </td></tr>
  <tr><td style="padding:0 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${top.map((h, i) => pieza(h, i + 1)).join("")}</table></td></tr>
  ${ciegos.length ? `<tr><td style="padding:8px 28px 0"><div style="font:900 18px Arial,sans-serif;color:#111;border-top:3px solid #111;padding-top:16px">Lo que un lado no cuenta</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${ciegos.map((h) => `<tr><td style="padding:12px 0;border-bottom:1px solid #e6e6e3"><span style="font:bold 11px Arial,sans-serif;color:#b26b00;text-transform:uppercase">La ${h.punto_ciego} no la cuenta</span><div style="font:bold 16px/1.3 Georgia,serif;color:#111;margin:4px 0 8px">${esc(h.titulo)}</div>${barra(h)}</td></tr>`).join("")}</table></td></tr>` : ""}
  <tr><td style="padding:24px 28px 28px" align="center"><a href="${WEB}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;font:bold 14px Arial,sans-serif;padding:12px 22px;border-radius:999px">Ver la portada completa</a></td></tr>
  </table>
  <p style="font:12px/1.5 Arial,sans-serif;color:#888;max-width:560px;margin:16px auto 0">Recibes este correo porque te suscribiste en Vista Plena. <a href="${baja}" style="color:#888">Darme de baja</a> · <a href="${WEB}metodologia.html" style="color:#888">Cómo lo hacemos</a></p>
  </td></tr></table></body></html>`;
}
const correoConfirmar = (enlace: string) => `<!doctype html><html lang="es"><body style="margin:0;background:#f4f4f2;padding:24px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border-radius:12px"><tr><td style="padding:28px">
    <div style="font:900 24px Arial,sans-serif;letter-spacing:-1px;color:#111">Vista Plena.</div>
    <p style="font:16px/1.5 Arial,sans-serif;color:#3d4047">Confirma que quieres recibir cada mañana el resumen del día: las historias que más medios cuentan, quién las cuenta y lo que un lado no cuenta.</p>
    <p style="margin:24px 0"><a href="${enlace}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;font:bold 15px Arial,sans-serif;padding:13px 24px;border-radius:999px">Confirmar suscripción</a></p>
    <p style="font:13px/1.5 Arial,sans-serif;color:#888">Si no has sido tú, ignora este correo y no volveremos a escribirte.</p>
  </td></tr></table></td></tr></table></body></html>`;

// ---------- Programa ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const u = new URL(req.url);
  const accion = u.searchParams.get("accion");
  try {
    if (accion === "alta") {
      const { email } = await req.json().catch(() => ({}));
      const correo = String(email ?? "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo) || correo.length > 200) return json({ ok: false, error: "Escribe un correo válido." }, 400);
      const { data: previo } = await db.from("suscriptores").select("*").eq("email", correo).maybeSingle();
      if (previo?.confirmado && !previo.baja_en) return json({ ok: true, estado: "ya" });
      // Para evitar abusos, como mucho un correo de confirmación cada 10 minutos por dirección
      if (previo?.ultimo_aviso && Date.now() - +new Date(previo.ultimo_aviso) < 10 * 60e3) return json({ ok: true, estado: "pendiente" });
      const { data: s } = await db.from("suscriptores")
        .upsert({ email: correo, ultimo_aviso: new Date().toISOString(), baja_en: null }, { onConflict: "email" }).select("token").single();
      await enviarCorreos([{ to: correo, subject: "Confirma tu suscripción a Vista Plena", html: correoConfirmar(`${FUNC}?accion=confirmar&token=${s!.token}`) }]);
      return json({ ok: true, estado: "pendiente" });
    }

    if (accion === "confirmar" || accion === "baja") {
      const token = u.searchParams.get("token") ?? "";
      if (!/^[0-9a-f-]{36}$/i.test(token)) return volver("error");
      const cambios = accion === "confirmar"
        ? { confirmado: true, confirmado_en: new Date().toISOString(), baja_en: null }
        : { confirmado: false, baja_en: new Date().toISOString() };
      const { data } = await db.from("suscriptores").update(cambios).eq("token", token).select("id");
      if (req.method === "POST") return new Response("ok", { headers: CORS }); // baja con un clic desde el gestor de correo
      return volver(data?.length ? (accion === "confirmar" ? "confirmado" : "baja") : "error");
    }

    if (accion === "enviar") {
      const prueba = u.searchParams.get("prueba"); // envía solo a un suscriptor confirmado, sin contar como envío del día
      const hoy = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" });
      const { data: H } = await db.from("portada_v2").select("titulo,total,voces,pct_izq,pct_cen,pct_der,punto_ciego,imagen,articulos,actualizada")
        .gte("actualizada", new Date(Date.now() - 26 * 3600e3).toISOString()).order("voces", { ascending: false }).limit(40);
      const top = (H ?? []).slice(0, 5);
      const ciegos = (H ?? []).filter((h) => h.punto_ciego && !top.includes(h)).slice(0, 3);
      if (top.length < 3) return json({ ok: false, error: "No hay suficientes historias para el resumen" });
      const fecha = new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Madrid" });
      const asunto = `Vista Plena · ${top[0].titulo.slice(0, 80)}`;

      let q = db.from("suscriptores").select("email,token").eq("confirmado", true).is("baja_en", null);
      if (prueba) q = q.eq("email", prueba.toLowerCase());
      else {
        // Una sola vez al día, aunque alguien vuelva a llamar a la función
        const { data: hecho } = await db.from("envios").insert({ fecha: hoy }).select("fecha");
        if (!hecho?.length) return json({ ok: true, estado: "ya enviado hoy" });
      }
      const { data: subs } = await q;
      const lista = (subs ?? []).map((s) => {
        const baja = `${FUNC}?accion=baja&token=${s.token}`;
        return { to: s.email, subject: asunto, html: correoDiario(top, ciegos, fecha, baja), baja };
      });
      const n = lista.length ? await enviarCorreos(lista) : 0;
      if (!prueba) await db.from("envios").update({ enviados: n }).eq("fecha", hoy);
      return json({ ok: true, enviados: n, prueba: !!prueba });
    }

    return json({ ok: false, error: "Acción desconocida" }, 404);
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: String(e).slice(0, 300) }, 500);
  }
});
