// Vista Plena — piezas comunes a todas las páginas: menú y funciones para pintar una historia.
const SUPA = { url: "https://yzreenyaerjitbfxsiah.supabase.co", key: "sb_publishable_1As_Elit5MJVUOZFOLeDjA_YMVv6jjF" };
const CAMPOS = "id,creada,titulo,total,voces,imagen,imagen_medio,pct_izq,pct_cen,pct_der,punto_ciego,actualizada,articulos,entradilla,entradilla_medio,anterior,tema_id";
const ETIQUETA = { "-2": "Izquierda", "-1": "Centroizquierda", "0": "Centro", "1": "Centroderecha", "2": "Derecha" };
const lado = o => o < 0 ? "izq" : o > 0 ? "der" : "cen";
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const enlace = h => `historia.html?id=${h.id}`;

// Convierte una fila de la base de datos en el formato corto que usan las páginas
const mapear = x => ({ id: x.id, t: x.titulo, tot: x.total, voces: x.voces, pi: x.pct_izq, pc: x.pct_cen, pd: x.pct_der, ciego: x.punto_ciego, act: x.actualizada, f: x.imagen, fm: x.imagen_medio,
  ent: x.entradilla, entm: x.entradilla_medio, cr: x.creada, ant: x.anterior, tema: x.tema_id,
  a: (x.articulos || []).map(a => ({ m: a.medio, o: a.orientacion, t: a.titulo, u: a.url, g: a.grupo, p: a.publicado })) });

async function pedir(ruta){
  const r = await fetch(`${SUPA.url}/rest/v1/${ruta}`, { headers: { apikey: SUPA.key, Authorization: "Bearer " + SUPA.key } });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}

function haceCuanto(iso){
  if (!iso) return "";
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 60) return `hace ${Math.max(m,1)} min`;
  const h = Math.round(m / 60);
  return h < 24 ? `hace ${h} h` : `hace ${Math.round(h/24)} d`;
}
function lectura(h){
  if (h.ciego === "izquierda") return `<strong>Punto ciego de la izquierda.</strong> Casi ningún medio de izquierdas la cuenta.`;
  if (h.ciego === "derecha") return `<strong>Punto ciego de la derecha.</strong> Casi ningún medio de derechas la cuenta.`;
  const d = h.pi - h.pd;
  if (d >= 20) return `La cuentan <strong>más los medios de izquierdas</strong>.`;
  if (d <= -20) return `La cuentan <strong>más los medios de derechas</strong>.`;
  return `<strong>Cobertura repartida</strong> entre izquierda, centro y derecha.`;
}
function barra(h, grande){
  const seg = (cls, v, et) => v ? `<div class="${cls}" style="flex-grow:${v}" title="${et}: ${v} %">${grande && v >= 12 ? v + " %" : ""}</div>` : "";
  return `<div class="barra${grande ? " grande" : ""}" role="img" aria-label="Izquierda ${h.pi} %, centro ${h.pc} %, derecha ${h.pd} %">${seg("b-izq",h.pi,"Izquierda")}${seg("b-cen",h.pc,"Centro")}${seg("b-der",h.pd,"Derecha")}</div>`;
}
const pct = h => `<div class="pct"><span class="i">Izquierda <b>${h.pi} %</b></span><span>Centro <b>${h.pc} %</b></span><span class="d">Derecha <b>${h.pd} %</b></span></div>`;
const meta = h => `<div class="meta"><span title="Dos medios del mismo grupo editorial y del mismo lado cuentan como una voz">${h.tot} medios${h.voces && h.voces < h.tot ? ` · ${h.voces} voces` : ""}</span><span>${haceCuanto(h.act)}</span>${h.ciego ? `<span class="chip">Punto ciego · ${h.ciego}</span>` : ""}</div>`;
// Un titular por medio, el más reciente; dentro de cada lado, primero lo último que se ha publicado
function recientes(h){
  const vistos = new Set();
  return [...h.a].sort((x, y) => new Date(y.p || 0) - new Date(x.p || 0)).filter(a => !vistos.has(a.m) && vistos.add(a.m));
}
function bloques(h, max = 99){
  const g = { izq: [], cen: [], der: [] };
  for (const a of recientes(h)) g[lado(a.o)].push(a);
  const b = (k, n, c) => `<div class="bloque"><div class="lado eti"><i style="background:${c}"></i>${n}</div>${g[k].length ? `<ul>${g[k].map((a, i) => `<li${i >= max ? " hidden" : ""}><span class="medio">${esc(a.m)}</span><a href="${esc(a.u)}" target="_blank" rel="noopener">${esc(a.t)}</a></li>`).join("")}</ul>${g[k].length > max ? `<button class="mas">Ver ${g[k].length - max} más</button>` : ""}` : `<p class="vacio">Ningún medio de este lado la ha publicado.</p>`}</div>`;
  return b("izq","Izquierda","var(--izq)") + b("cen","Centro","var(--cen)") + b("der","Derecha","var(--der)");
}
// Foto del propio medio, enlazada desde su web y con crédito. Si no carga, desaparece.
function foto(h, extra = ""){
  if (!h.f) return "";
  return `<figure class="foto ${extra}"><img src="${esc(h.f)}" alt="" loading="lazy" referrerpolicy="no-referrer" decoding="async"
    onload="this.classList.add('ok')" onerror="this.closest('figure').remove()"><figcaption>Foto: ${esc(h.fm)}</figcaption></figure>`;
}

// «Ver más» titulares de un lado
document.addEventListener("click", e => {
  const b = e.target.closest(".mas"); if (!b) return;
  b.previousElementSibling.querySelectorAll("li[hidden]").forEach(li => li.hidden = false);
  b.remove();
});

// Menú desplegable
(() => {
  const btn = document.getElementById("abrirMenu"), menu = document.getElementById("menu");
  if (!btn || !menu) return;
  const poner = abierto => {
    menu.hidden = !abierto;
    btn.setAttribute("aria-expanded", abierto);
    btn.querySelector(".hamb-txt").textContent = abierto ? "Cerrar" : "Menú";
    document.body.classList.toggle("menu-abierto", abierto);
  };
  btn.addEventListener("click", () => poner(menu.hidden));
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !menu.hidden) { poner(false); btn.focus(); } });
  document.addEventListener("click", e => { if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) poner(false); });
  menu.addEventListener("click", e => { if (e.target.closest("a")) poner(false); });
})();
