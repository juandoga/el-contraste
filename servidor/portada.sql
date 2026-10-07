-- Vista Plena — vista «portada_v2»: calcula, para cada historia, quién la cuenta y si es un punto ciego.
-- Es la que alimenta la web y los datos abiertos. Se ejecuta en Supabase (Postgres).

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
  -- Punto ciego: al menos 4 voces, la mitad o más de un lado y menos del 10 % del otro
  case
    when coalesce(t.ligera, false) then null
    when c.voces >= 4 and c.izq::numeric / c.voces < 0.10 and c.der::numeric / c.voces >= 0.5 then 'izquierda'
    when c.voces >= 4 and c.der::numeric / c.voces < 0.10 and c.izq::numeric / c.voces >= 0.5 then 'derecha'
  end as punto_ciego,
  (select jsonb_agg(jsonb_build_object('medio', m.nombre, 'orientacion', m.orientacion, 'grupo', coalesce(m.grupo, m.nombre), 'titulo', a.titulo, 'url', a.url) order by m.orientacion, a.publicado)
     from articulos a join medios m on m.id = a.medio_id where a.historia_id = h.id) as articulos,
  f.imagen, f.imagen_medio,
  coalesce(t.ligera, false) as ligera
from historias h
join cuentas c on c.historia_id = h.id
left join tipo t on t.historia_id = h.id
left join lateral (
  -- Foto: la del medio más cercano al centro que la publique
  select a.imagen, m.nombre as imagen_medio from articulos a join medios m on m.id = a.medio_id
  where a.historia_id = h.id and a.imagen is not null and a.imagen !~* '\.(mp4|m3u8|mp3|webm|mov)(\?|$)'
  order by abs(m.orientacion), a.publicado limit 1
) f on true
where c.total >= 3;
