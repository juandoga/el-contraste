-- Vista Plena — vista «portada_v2»: calcula, para cada historia, quién la cuenta y si es un punto ciego.
-- Es la que alimenta la web y los datos abiertos. Se ejecuta en Supabase (Postgres).

alter table historias add column if not exists anterior bigint;
-- Titulares del lado que «falta» que hablan de lo mismo con otro enfoque (los rellena recoger, paso 3c)
alter table historias add column if not exists tambien jsonb not null default '[]';
create or replace function poner_tambien(datos jsonb) returns void language sql security definer set search_path = public as $$
  update historias h set tambien = d.tambien from jsonb_to_recordset(datos) as d(id bigint, tambien jsonb) where h.id = d.id;
$$;
revoke execute on function poner_tambien(jsonb) from public, anon, authenticated;

create or replace view portada_v2 with (security_invoker = true) as
with por_medio as (
  -- Cada medio cuenta una vez por historia, con su lado (izquierda, centro o derecha)
  select distinct a.historia_id, m.id as medio_id, m.orientacion, coalesce(m.grupo, m.nombre) as grupo,
    case when m.orientacion < 0 then 'izq' when m.orientacion > 0 then 'der' else 'cen' end as lado
  from articulos a join medios m on m.id = a.medio_id
  where a.historia_id is not null
), voces as (
  -- Dos medios del mismo grupo editorial y del mismo lado cuentan como una sola voz
  select distinct historia_id, grupo, lado from por_medio
), cuentas as (
  select v.historia_id, count(*) as voces,
    count(*) filter (where v.lado = 'izq') as izq,
    count(*) filter (where v.lado = 'cen') as cen,
    count(*) filter (where v.lado = 'der') as der,
    (select count(*) from por_medio p where p.historia_id = v.historia_id) as total
  from voces v group by v.historia_id
), tipo as (
  -- Noticias de deportes, corazón, tiempo, sorteos, televisión u ocio: no cuentan como punto ciego.
  -- Se reconocen por la sección del medio en la dirección o por palabras del titular, en la mitad o más de sus titulares.
  select a.historia_id,
    avg(case when a.url ~* '/(deportes?|futbol|baloncesto|tenis|motor|formula-?1|motogp|ciclismo|laotraliga|gente|famosos|corazon|casa-?real|casas-reales|realeza|cool|chic|lifestyle|estilo|moda|belleza|vanitatis|television|tv|series|el-?tiempo|tiempo|meteorologia|loterias?|horoscopo|viajes|gastronomia|recetas|videojuegos|toros)(/|$)'
               or a.titulo ~* '(loter[ií]a|sorteo|bonoloto|euromillones|la primitiva|super ?once|cup[oó]n de la once|aemet|alerta (naranja|amarilla|roja)|avisos? (naranja|amarillo|rojo)|lluvias|tormentas|\ydana\y|temperaturas|ola de calor|el tiempo (hoy|de|para|en)|horóscopo)'
             then 1 else 0 end) >= 0.5 as ligera
  from articulos a where a.historia_id is not null group by a.historia_id
)
select h.id, h.titulo, h.creada, h.actualizada, c.total, c.voces, c.izq, c.cen, c.der,
  round(100.0 * c.izq / c.voces)::integer as pct_izq,
  round(100.0 * c.der / c.voces)::integer as pct_der,
  100 - round(100.0 * c.izq / c.voces)::integer - round(100.0 * c.der / c.voces)::integer as pct_cen,
  -- Punto ciego: al menos 4 voces, la mitad o más de un lado y menos del 10 % del otro,
  -- y ningún medio de ese otro lado lo ha contado con otro enfoque (h.tambien)
  case
    when coalesce(t.ligera, false) then null
    when c.voces >= 4 and c.izq::numeric / c.voces < 0.10 and c.der::numeric / c.voces >= 0.5
      and not exists (select 1 from jsonb_array_elements(h.tambien) x where (x->>'orientacion')::int < 0) then 'izquierda'
    when c.voces >= 4 and c.der::numeric / c.voces < 0.10 and c.izq::numeric / c.voces >= 0.5
      and not exists (select 1 from jsonb_array_elements(h.tambien) x where (x->>'orientacion')::int > 0) then 'derecha'
  end as punto_ciego,
  (select jsonb_agg(jsonb_build_object('medio', m.nombre, 'orientacion', m.orientacion, 'grupo', coalesce(m.grupo, m.nombre), 'titulo', a.titulo, 'url', a.url, 'publicado', a.publicado) order by m.orientacion, a.publicado)
     from articulos a join medios m on m.id = a.medio_id where a.historia_id = h.id) as articulos,
  f.imagen, f.imagen_medio,
  coalesce(t.ligera, false) as ligera,
  e.entradilla, e.entradilla_medio,
  -- Orden de la portada: medios que han contado la historia en las últimas 12 horas
  (select count(distinct a.medio_id) from articulos a where a.historia_id = h.id and a.publicado > now() - interval '12 hours') as medios_12h,
  -- Historia anterior de la que esta se separó porque trae un hecho nuevo (p. ej. «los favoritos al Nobel» → «Anne Carson gana el Nobel»)
  h.anterior,
  -- Tema al que pertenece (asunto de varios días que reúne varias historias; ver servidor/temas)
  h.tema_id,
  -- Titulares de un lado ausente que cuentan lo mismo con otro enfoque (no cuentan en los porcentajes)
  h.tambien
from historias h
join cuentas c on c.historia_id = h.id
left join tipo t on t.historia_id = h.id
left join lateral (
  -- Foto: la del medio más cercano al centro que la publique (la más reciente)
  select a.imagen, m.nombre as imagen_medio from articulos a join medios m on m.id = a.medio_id
  where a.historia_id = h.id and a.imagen is not null and a.imagen !~* '\.(mp4|m3u8|mp3|webm|mov)(\?|$)'
  order by abs(m.orientacion), a.publicado desc limit 1
) f on true
left join lateral (
  -- Entradilla: el resumen que publica el medio más cercano al centro (con al menos 80 caracteres; la más reciente)
  select a.resumen as entradilla, m.nombre as entradilla_medio from articulos a join medios m on m.id = a.medio_id
  where a.historia_id = h.id and char_length(a.resumen) >= 80
  order by abs(m.orientacion), a.publicado desc limit 1
) e on true
where c.total >= 3;

-- Avisos de error de los lectores: cualquiera puede enviar uno, nadie puede leerlos desde la web.
create table if not exists reportes (
  id bigint generated always as identity primary key,
  historia_id bigint not null,
  motivo text not null check (motivo in ('titular_no_encaja','historia_duplicada','etiqueta_medio','otro')),
  detalle text check (char_length(detalle) <= 1000),
  creado timestamptz not null default now(),
  revisado boolean not null default false
);
alter table reportes enable row level security;
create policy "cualquiera puede avisar" on reportes for insert to anon, authenticated with check (revisado = false and historia_id > 0);
revoke all on reportes from anon, authenticated;
grant insert (historia_id, motivo, detalle) on reportes to anon, authenticated;

-- Archivo histórico: una ficha por historia (cobertura y medios que la publicaron), que no se borra.
create table if not exists archivo (
  historia_id bigint primary key, titulo text not null, creada timestamptz, actualizada timestamptz,
  total int, voces int, izq int, cen int, der int, pct_izq int, pct_cen int, pct_der int,
  punto_ciego text, ligera boolean, medios jsonb, archivada timestamptz not null default now(),
  fusionada boolean not null default false
);
-- archivar(): copia cada hora (minuto 20) las historias visibles de portada_v2 y marca como «fusionada»
-- la historia reciente que desaparece al unirse con otra. Lectura pública; solo el servidor escribe.

-- Temas: asuntos concretos de varios días («Caso Leire», «Nobel de Literatura») que reúnen varias historias en orden.
-- Los calcula cada hora la función servidor/temas. Para la portada: los activos, con cuántas historias nuevas tienen en 48 horas.
create or replace view temas_v with (security_invoker = true) as
select t.id, t.nombre, t.inicio, t.actualizado, t.historias, t.activo,
  (select count(*) from historias h where h.tema_id = t.id and h.creada > now() - interval '48 hours') as nuevas_48h
from temas t;
