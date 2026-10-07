# Vista Plena

**Cada noticia, contada por todos los lados.**
[vistaplena.es](https://vistaplena.es)

Vista Plena reúne los titulares de más de 30 medios españoles, junta los que hablan del mismo hecho y muestra cuántos medios de izquierda, de centro y de derecha cuentan cada noticia. Así se ve qué historias cuenta todo el mundo, cuáles cuenta sobre todo un lado y cuáles apenas llegan a los lectores de un lado (los **puntos ciegos**).

No escribe noticias ni opina sobre ellas. No hay algoritmo: la portada es la misma para todo el mundo y se ordena por el número de medios que cuentan cada historia.

## Cómo funciona

1. **Leer.** Cada hora se leen los canales públicos de cada medio: RSS, mapas de noticias o, si no hay otro modo, la portada.
2. **Agrupar.** Los titulares que hablan del mismo hecho se juntan en una historia, comparando sus palabras clave.
3. **Contar.** Para cada historia se cuenta cuántos medios de cada lado la publican. Dos medios del mismo grupo y del mismo lado cuentan como una sola voz.
4. **Mostrar.** La barra de colores enseña el reparto, y al lado aparece cómo titula cada lado.

Todo se explica con detalle en la [metodología](https://vistaplena.es/metodologia.html).

## Las etiquetas de los medios

Cada **medio** (no cada noticia) tiene una etiqueta en cinco niveles: izquierda, centroizquierda, centro, centroderecha y derecha. Se basa en la ideología media de sus lectores según encuestas públicas y en su línea editorial. Es una clasificación revisable, no un juicio sobre su calidad.

## Qué es un punto ciego

Una historia es un punto ciego de la izquierda cuando la cuentan al menos 4 voces, la mitad o más son de derechas y las de izquierdas son menos del 10 %. El de la derecha es lo mismo al revés.

No se marcan como punto ciego las noticias de deportes, corazón, tiempo, sorteos, televisión u ocio.

## Datos abiertos

Los datos se pueden consultar libremente en formato JSON:

- Historias con su cobertura: `https://yzreenyaerjitbfxsiah.supabase.co/rest/v1/portada_v2?select=*&apikey=sb_publishable_1As_Elit5MJVUOZFOLeDjA_YMVv6jjF`
- Medios, etiquetas y estado de lectura: `https://yzreenyaerjitbfxsiah.supabase.co/rest/v1/estado_medios?select=*&apikey=sb_publishable_1As_Elit5MJVUOZFOLeDjA_YMVv6jjF`
- Archivo histórico (una ficha por historia desde el 8 de octubre de 2026): `https://yzreenyaerjitbfxsiah.supabase.co/rest/v1/archivo?select=*&fusionada=eq.false&apikey=sb_publishable_1As_Elit5MJVUOZFOLeDjA_YMVv6jjF`
- Guía electoral 29N: [`programas.json`](programas.json)

La clave que aparece en estas direcciones es pública y solo permite leer.

## Qué hay en este repositorio

| Archivo o carpeta | Qué es |
|---|---|
| `index.html` | Portada |
| `historia.html` | Página de cada historia |
| `metodologia.html` | Cómo lo hacemos, con la tabla de medios en directo |
| `elecciones.html` · `programas.json` | Guía de las elecciones del 29N |
| `quienes-somos.html` · `aviso-legal.html` · `privacidad.html` | Información del proyecto y legal |
| `comun.js` | Menú y funciones compartidas por todas las páginas |
| `temas.js` | Secciones por tema (vivienda, economía…) y las palabras que las definen |
| `servidor/recoger/` | Programa que lee los medios y agrupa los titulares (se ejecuta cada hora) |
| `servidor/boletin/` | Programa del boletín diario por correo |
| `servidor/portada.sql` | Cálculo de la cobertura y de los puntos ciegos |

La web es estática y se publica con GitHub Pages. Los datos y los programas del servidor funcionan en Supabase.

## Límites conocidos

- La agrupación es automática y a veces junta dos noticias distintas o separa la misma en dos.
- Algunos medios publican muchos más titulares que otros. Para compensarlo se limita el número de titulares por medio y se excluyen las ediciones locales y la opinión.
- Algunos medios no ofrecen canales que se puedan leer, como Telecinco, y no están incluidos.

## Derechos de uso

© 2026 Vista Plena. Todos los derechos reservados.

- **Datos:** se pueden consultar, citar y usar con fines periodísticos, de investigación, educativos o personales, citando la fuente: *Vista Plena (vistaplena.es)*.
- **Código, diseño, marca y textos:** se pueden consultar, pero no reutilizar sin permiso por escrito.
- Cualquier uso comercial, la copia sistemática de los datos o su uso para crear un servicio parecido necesitan permiso por escrito.

Las condiciones completas están en el [aviso legal](https://vistaplena.es/aviso-legal.html#uso).

## Errores y propuestas

Si ves una noticia mal agrupada, un medio mal etiquetado o un dato equivocado, [abre una propuesta](https://github.com/juandoga/vistaplena/issues/new). Los cambios aceptados se anotan con su fecha en la web.
