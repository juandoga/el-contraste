-- Vista Plena — clasifica las votaciones del Congreso por tipo y por tema para la guía 29N.
-- Se ejecuta cada hora (cron «etiquetar-votaciones»). Si una votación está mal clasificada,
-- se corrige a mano rellenando votaciones.temas_manual, que manda sobre las palabras clave.
CREATE OR REPLACE FUNCTION public.etiquetar_votaciones()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update votaciones v set
    tipo = case
      when v.expediente ilike 'Tramitación como Proyecto de Ley%' then 'tramite'
      when v.titulo ilike 'Convalidación o derogación de Reales Decretos-leyes%' then 'decreto'
      when v.titulo ilike 'Toma en consideración de Proposiciones de Ley%' then 'toma'
      when v.titulo ilike 'Debates de totalidad de iniciativas legislativas%' then 'totalidad'
      when v.titulo ilike 'Dictámenes de Comisiones sobre iniciativas legislativas%' and (v.subgrupo ilike 'Votación de conjunto%' or v.subgrupo ilike 'Votación del dictamen%' or v.subgrupo = '') then 'ley'
      when v.titulo ilike 'Proposiciones no de Ley%' or v.titulo ilike 'Mociones consecuencia%' then 'no_vinculante'
      else 'otra' end,
    temas = coalesce(v.temas_manual, array(select t from (values
      ('vivienda',   '(vivienda|alquiler|arrendamiento|desahucio|okupa|ocupacion ilegal|inquilin|suelo urbano|ley del suelo|hipotec)'),
      ('economia',   '(inflacion|precios|cesta de la compra|presupuestos generales|ley general presupuestaria|estabilidad presupuestaria|techo de gasto|deficit|aranceles|crecimiento economico|poder adquisitivo|salario minimo|consecuencias economicas|en materia economica|reconstruccion economica|plan integral de respuesta a la crisis|anticrisis)'),
      ('inmigracion','(inmigra|migra|extranjer|asilo|regularizacion|menores no acompanados|frontera|refugiad)'),
      ('empleo',     '(empleo|laboral|trabajador|salario minimo|jornada|despido|desemplead|paro\M|estatuto de los trabajadores)'),
      ('sanidad',    '(sanidad|sanitari|salud|hospital|medic[oa]s|farmac|listas de espera|atencion primaria|dependencia)'),
      ('pensiones',  '(pension|jubilacion|seguridad social|mutualista)'),
      ('impuestos',  '(impuesto|tributari|irpf|\miva\M|recaudacion|reforma fiscal|presion fiscal|beneficios fiscales|medidas fiscales)'),
      ('educacion',  '(educacion|educativ|escuela|universidad|becas|profesorado|alumnado|formacion profesional|ensenanza)'),
      ('territorial','(financiacion autonomica|comunidades autonomas|financiacion de cataluna|singular de cataluna|amnistia|condonacion|estatuto de autonomia|concierto economico|lenguas cooficiales)'),
      ('energia',    '(energia|energetic|electric|renovable|nuclear|clima|emisiones|transicion ecologica|combustible|carburantes|apagon)'),
      ('justicia',   '(corrupcion|judicial|justicia|jueces|juezas|fiscal general|ministerio fiscal|poder judicial|transparencia|blanqueo|amnistia|indulto|grupos de interes)')
    ) as r(t, re) where lower(unaccent(v.expediente || ' ' || coalesce(v.subgrupo_texto, ''))) ~ r.re)),
    -- Destacadas: las que deciden algo (decretos, proposiciones de ley, enmiendas a la totalidad y votaciones finales de leyes)
    destacada = v.titulo ilike 'Convalidación%' and v.expediente not ilike 'Tramitación como Proyecto de Ley%'
      or v.titulo ilike 'Toma en consideración de Proposiciones de Ley%'
      or v.titulo ilike 'Debates de totalidad de iniciativas legislativas%'
      or (v.titulo ilike 'Dictámenes de Comisiones sobre iniciativas legislativas%' and (v.subgrupo ilike 'Votación de conjunto%' or v.subgrupo ilike 'Votación del dictamen%' or v.subgrupo = ''));
end $function$;
