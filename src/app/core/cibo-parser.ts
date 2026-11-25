import { Field, Section, StatusSheet, norm } from './ficha-parser.service';

/*
 * Leitura das fichas do RPG Cibo. Mesmo princípio do RPG Dark: só as linhas
 * editadas são reescritas, então exportar sem mexer devolve o arquivo idêntico.
 *
 * Formato:
 *   ===== >> STATUS << =====
 *   Status >> Geral começa com 20 ( 0 pontos)
 *   Nome = Fulano                          (identidade: Chave = valor)
 *   Gosta de [ até 5 coisas ] = (a/b/c)
 *   [ HP ] = 150 (+20) = 170               (vitais)
 *   Defesa Física = 10                     (valores soltos)
 *   [= Acerto =] ( 30 )                    (categoria e total de pontos)
 *       |_>> Precisão Corpo a Corpo = 10 ( +5 ) = 30%
 *   ======[ Passivas ]======               (seções de texto livre)
 */

const RE = {
  cabecalho: /^\s*=+\s*\[\s*(.+?)\s*\]\s*=+\s*$/,
  cabecalhoSolto: /^\s*={3,}\s+([^=[\]]*?[A-Za-zÀ-ú?][^=[\]]*?)\s+={3,}\s*$/,
  pontos: /^(Status\s*>>.*?\(\s*)(-?\d*)(\s*pontos?\s*\).*)$/i,
  gostaIgual: /^(Gosta de\s*\[[^\]]*\]\s*=\s*\()(.*)(\).*)$/i,
  gostaColchete: /^(Gosta de\s*\[)(.*?)(\].*)$/i,
  identidade: /^(Personalidade|Sexo|Ra.a|Altura|Idade|Nome|Classe)(\s*[:=]\s*)(.*?)(\s*)$/i,
  categoria: /^\s*\[=\s*(.+?)\s*=\]/,
  totalCategoria: /^(\s*\[=.*?=\]\s*\(\s*)(-?\d+)(\s*\).*)$/,
  vital: /^(\[\s*([^\]=]*[A-Za-zÀ-ú.][^\]=]*?)\s*\]\s*=\s*)(.*?)(\s*)$/,
  atributo: /^(\s*\|_?>>\s*)([^=]+?)(\s*=\s*)(.*?)(\s*)$/,
  item: /^(\s*\|_?>>\s*)(.*?)(\s*)$/,
  solto: /^([A-Za-zÀ-ú][^=[\]|]*?)(\s*=\s*)(.*?)(\s*)$/,
  numero: /^[+-]?\s*\d+$/,
};

/** Cabeçalhos que abrem seção de texto livre (o resto vira categoria). */
const SECAO_LIVRE = /passiva|buff|habilidade|transforma|muta|lore|profiss|conceito|imagin|\?{3}/i;

export function detectStatusCibo(text: string): boolean {
  return /=+\s*>>\s*STATUS\s*<<\s*=+/i.test(text) || /^\s*\[=\s*.+?\s*=\]/m.test(text);
}

export function parseStatusCibo(text: string): StatusSheet {
  const lines = text.replace(/\r/g, '').split('\n');
  const fields: Field[] = [];
  const sections: Section[] = [];
  let cat = 'Identidade';
  let sec: Section | null = null;

  const add = (f: Omit<Field, 'line'>, i: number) => fields.push({ ...f, line: i } as Field);

  lines.forEach((line, i) => {
    let m = line.match(RE.cabecalho) ?? line.match(RE.cabecalhoSolto);
    if (m) {
      const titulo = m[1].trim();
      if (/>>|<</.test(titulo)) return; // "===== >> STATUS << ====="
      if (SECAO_LIVRE.test(titulo)) {
        if (sec) sec.end = i;
        sec = { title: titulo, start: i + 1, end: lines.length, text: '' };
        sections.push(sec);
        return;
      }
      if (sec) { sec.end = i; sec = null; }
      cat = titulo;
      return;
    }
    if (sec) return; // dentro de texto livre

    if ((m = line.match(RE.pontos))) {
      add({ id: 'pontos', kind: 'raw', cat: 'Identidade', key: 'Pontos livres', pre: m[1], value: m[2], post: m[3] }, i);
      return;
    }
    if ((m = line.match(RE.gostaIgual) ?? line.match(RE.gostaColchete))) {
      add({ id: 'gosta', kind: 'raw', cat: 'Identidade', key: 'Gosta de', pre: m[1], value: m[2], post: m[3] }, i);
      return;
    }
    if ((m = line.match(RE.identidade))) {
      add({ id: 'id_' + norm(m[1]), kind: 'raw', cat: 'Identidade', key: m[1], pre: m[1] + m[2], value: m[3], post: m[4] }, i);
      return;
    }
    if ((m = line.match(RE.categoria))) {
      cat = m[1];
      const t = line.match(RE.totalCategoria);
      if (t) add({ id: norm(cat) + '|__total', kind: 'num', cat, key: 'Total da categoria', pre: t[1], value: t[2], post: t[3] }, i);
      return;
    }
    if ((m = line.match(RE.vital)) && m[2].trim().length > 1) {
      add({ id: 'vital_' + norm(m[2]), kind: 'text', cat: 'Vitais', key: m[2].trim(), pre: m[1], value: m[3], post: m[4] }, i);
      return;
    }
    if ((m = line.match(RE.atributo))) {
      const kind = RE.numero.test(m[4].trim()) ? 'num' : 'text';
      add({ id: norm(cat) + '|' + norm(m[2]), kind, cat, key: m[2].trim(), pre: m[1] + m[2] + m[3], value: m[4], post: m[5] }, i);
      return;
    }
    if ((m = line.match(RE.item))) {
      add({ id: norm(cat) + '|item', kind: 'text', cat, key: '•', pre: m[1], value: m[2], post: m[3] }, i);
      return;
    }
    if ((m = line.match(RE.solto))) {
      add({ id: 'geral|' + norm(m[1]), kind: 'text', cat: 'Geral', key: m[1].trim(), pre: m[1] + m[2], value: m[3], post: m[4] }, i);
      cat = m[1].trim(); // "|_>>" logo abaixo pertencem a este valor
    }
  });

  const seen: Record<string, number> = {};
  fields.forEach(f => { if (seen[f.id]) f.id += '#' + (++seen[f.id]); else seen[f.id] = 1; });
  sections.forEach(s => { s.text = lines.slice(s.start, s.end).join('\n'); });
  return { lines, fields, sections };
}

/** Modelo de ficha nova do RPG Cibo (só a estrutura, sem valores). */
export function statusTemplateCibo(nome: string): string {
  return [
    '===== >> STATUS << =====',
    'Status >> Geral começa com 20 ( 0 pontos)',
    '',
    'Personalidade = ',
    '',
    'Sexo = ',
    '',
    'Raça = ',
    '',
    'Altura = ',
    '',
    'Idade = ',
    '',
    'Gosta de [ até 5 coisas ] = ()',
    '',
    `Nome = ${nome}`,
    '',
    '=====================================',
    '',
    '[ HP ] = ',
    '',
    '[ Energia ] = ',
    '',
    '[ C.O ] = ',
    '',
    '=====================================',
    '',
    '==============[ Passivas ]==============',
    '',
    '==============[ Buffs ]==============',
    '',
    '==============[ Habilidades ]==============',
    '',
    '==============[ Transformação ]==============',
    '',
  ].join('\r\n');
}
