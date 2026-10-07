// Vista Plena — secciones por tema, ordenadas según los principales problemas del CIS (septiembre de 2026).
// Una historia entra en una sección si su titular, o al menos dos titulares de sus medios, contienen palabras de esa sección.
// Esta lista es pública y cualquiera puede proponer cambios.
window.SECCIONES = [
  { id: "vivienda", nombre: "Vivienda", cis: 37.5, cisNota: "principal problema de España",
    // «vivienda» sola no basta (evita sucesos como «explosión en una vivienda»): debe ir con política, precio o acceso
    re: /(precio|acceso|ley|decretos?|crisis|política|parque|derecho|huelga|manifestación|ministr[oa]|plan|bono|ayudas?)[^.]{0,25}vivienda|vivienda (pública|social|protegida|asequible|digna)|alquiler|inquilin|hipotec|desahuci|okupa|zona tensionada|\bvpo\b|inmobiliari|fondos? buitre/i },
  { id: "economia", nombre: "Economía y precios", cis: 21.6, cisNota: "crisis económica",
    re: /econom|inflaci|\bipc\b|precios?\b|impuesto|\birpf\b|\biva\b|\bpib\b|presupuesto|déficit|deuda pública|pensi|banco de españa|bce\b|tipos de interés|ibex|bolsa|aranceles|factura|cesta de la compra|luz y gas|carburante/i },
  { id: "inmigracion", nombre: "Inmigración", cis: 19.7, cisNota: "tercer problema",
    re: /inmigra|migrant|patera|cayuco|frontera|regularizaci|\basilo\b|refugiad|menores no acompañados|\bmenas?\b|\bcie\b|extranjería|salvamento marítimo/i },
  { id: "politica", nombre: "Política", cis: 18.8, cisNota: "el Gobierno y los partidos",
    re: /elecciones|\b29-?n\b|campaña electoral|precampaña|congreso|senado|investidura|moción de censura|gobierno|feijóo|sánchez|abascal|\bpsoe\b|\bpp\b|\bvox\b|sumar|junts|\berc\b|bildu|\bpnv\b|podemos|amnistía|puigdemont|procés|corrupci|imputa|fiscal general|constitucional|supremo|diputación permanente|financiación autonómica/i },
  { id: "empleo", nombre: "Empleo", cis: 13.7, cisNota: "calidad del empleo (y 11,5 % el paro)",
    re: /empleo|\bparo\b|desemplead|salario|\bsmi\b|sueldo|huelga|sindicat|ccoo|\bugt\b|trabajador|autónomos|\bere\b|despido|jornada laboral|reducción de jornada|convenio|afiliación|seguridad social/i },
  { id: "sanidad", nombre: "Sanidad", cis: 11.1, cisNota: "sanidad",
    re: /sanidad|sanitari|médic|hospital|listas? de espera|atención primaria|enfermer|urgencias|salud mental|ministerio de sanidad|vacuna|epidemi|brote|estatuto marco/i },
];

window.seccionesDe = function (h) {
  const titulos = [h.t, ...(h.a || []).map(a => a.t)];
  return window.SECCIONES.filter(s => s.re.test(h.t) || titulos.filter(t => s.re.test(t)).length >= 2).map(s => s.id);
};
