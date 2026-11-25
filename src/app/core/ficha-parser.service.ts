import { Injectable } from '@angular/core';

/*
 * Leitura/escrita das fichas .txt (Status e Mochila).
 * Regra de ouro: exportar sem alterações gera o .txt idêntico ao importado
 * (só as linhas de campos editados — `dirty` — são reescritas).
 */

export type FieldKind = 'nivel' | 'raw' | 'vital' | 'dice' | 'num' | 'text';

export interface Field {
  id: string;
  line: number;
  kind: FieldKind;
  cat: string;
  key: string;
  pre: string;
  value: string;
  post: string;
  dirty?: boolean;
  /** linha marcada com "*": atributo que recebe pontos livres */
  star?: boolean;
  // dice
  die?: number;
  b1?: number;
  b2?: number;
  auto?: boolean;
  /** texto depois de "dN+total" (ex.: " até 40 kg"), preservado ao reescrever */
  suffix?: string;
  // nivel
  nivel?: number;
  pontos?: number | null;
  pontosNivel?: number | null;
}

export interface Section {
  title: string;
  start: number;
  end: number;
  text: string;
}

export interface StatusSheet {
  lines: string[];
  fields: Field[];
  sections: Section[];
}

export interface MochilaAttr {
  pre: string;
  key: string;
  value: string;
}
export interface MochilaItem {
  name: string;
  attrs: MochilaAttr[];
  notes: string[];
}
export interface MochilaSection {
  header: string;
  title: string;
  level: number;
  items: MochilaItem[];
}
export interface Mochila {
  sections: MochilaSection[];
  /** linhas originais; usadas para exportar idêntico enquanto nada for editado */
  lines: string[];
  dirty: boolean;
}

export type Tokens = Record<
  | 'prec_cc' | 'prec_la' | 'esq_cc' | 'esq_la' | 'corrida' | 'reacao' | 'reflexo'
  | 'atk_cc' | 'atk_la' | 'intimidacao' | 'convencer' | 'enganar'
  | 'stress_teste' | 'stress_dano',
  string
>;

export const TOKEN_NAMES: (keyof Tokens)[] = [
  'prec_cc', 'prec_la', 'esq_cc', 'esq_la', 'corrida', 'reacao', 'reflexo',
  'atk_cc', 'atk_la', 'intimidacao', 'convencer', 'enganar', 'stress_teste', 'stress_dano',
];

export const norm = (s: string | null | undefined): string =>
  (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const sign = (n: number): string => (n < 0 ? '-' : '+') + Math.abs(n);

// ---------------- STATUS ----------------
const RE = {
  attr: /^(\s*\|_?>>\s*)([^=]+?)(\s*=\s*)(.*?)(\s*\*?\s*)$/,
  cat: /^\[\s*--\s*(.+?)\s*--\s*\]/,
  section: /^={4,}>>\s*(.+?)\s*<<={4,}\s*$/,
  nivel: /^=\[\s*N.vel\s*\]=/i,
  exp: /^(-=>>\s*Exp\s*=\s*)(.*)$/i,
  resets: /^(-=>>\s*Resets\s*=\s*\[)(.*?)(\].*)$/i,
  simple: /^(Personalidade|Idade|Sexo|Ra.a|Classe|Altura|Nome)(\s*[:=]\s*)(.*)$/i,
  gosta: /^(Gosta de\s*>>\[)(.*)(\]<<.*)$/i,
  vital: /^(\[\s*(HP|Energia|C\.O|Stress)\s*\]\s*=\s*)(-?\d+)(.*)$/i,
  dice: /^d(\d+)\s*\(\s*([+-]?)\s*(\d+)\s*\)\s*\(\s*([+-]?)\s*(\d+)\s*\)/i,
  diceTotal: /^\s*d\d+\s*(?:[+-]\s*\d+)?/i,
  num: /^([+-]?)\s*(\d+)$/,
};

export function parseStatus(text: string): StatusSheet {
  const lines = text.replace(/\r/g, '').split('\n');
  const fields: Field[] = [];
  const sections: Section[] = [];
  let cat = 'Geral';
  let sec: Section | null = null;
  lines.forEach((line, i) => {
    let m: RegExpMatchArray | null;
    if ((m = line.match(RE.section))) {
      if (sec) sec.end = i;
      sec = { title: m[1], start: i + 1, end: lines.length, text: '' };
      sections.push(sec);
      return;
    }
    if (sec) return; // dentro de bloco livre
    if ((m = line.match(RE.cat))) { cat = m[1]; return; }
    if (/^\s*Defesa\s*$/i.test(line)) { cat = 'Defesa'; return; }
    if (/^\s*Resist.ncias Adicionais\s*$/i.test(line)) { cat = 'Resistências Adicionais'; return; }
    if (RE.nivel.test(line)) {
      const lv = line.match(/\[\s*(\d+)\s*\]/);
      const pts = line.match(/\(\s*\+?\s*(-?\d+)\s*\)\s*pontos/i);
      const nv = line.match(/\(\s*\+?\s*(-?\d+)\s*\)\s*n.vel/i);
      fields.push({
        id: 'nivel', line: i, kind: 'nivel', cat: 'Identidade', key: 'Nível', pre: '', value: '', post: '',
        nivel: lv ? +lv[1] : 0, pontos: pts ? +pts[1] : null, pontosNivel: nv ? +nv[1] : null,
      });
      return;
    }
    if ((m = line.match(RE.exp))) { fields.push({ id: 'exp', line: i, kind: 'raw', cat: 'Identidade', key: 'Exp', pre: m[1], value: m[2], post: '' }); return; }
    if ((m = line.match(RE.resets))) { fields.push({ id: 'resets', line: i, kind: 'raw', cat: 'Identidade', key: 'Resets', pre: m[1], value: m[2], post: m[3] }); return; }
    if ((m = line.match(RE.gosta))) { fields.push({ id: 'gosta', line: i, kind: 'raw', cat: 'Identidade', key: 'Gosta de', pre: m[1], value: m[2], post: m[3] }); return; }
    if ((m = line.match(RE.simple))) { fields.push({ id: 'id_' + norm(m[1]), line: i, kind: 'raw', cat: 'Identidade', key: m[1], pre: m[1] + m[2], value: m[3], post: '' }); return; }
    if ((m = line.match(RE.vital))) {
      fields.push({ id: 'vital_' + norm(m[2]), line: i, kind: 'vital', cat: 'Vitais', key: m[2], pre: m[1], value: m[3], post: m[4] });
      return;
    }
    if ((m = line.match(RE.attr))) {
      const f: Field = { id: norm(cat) + '|' + norm(m[2]), line: i, kind: 'text', cat, key: m[2].trim(), pre: m[1] + m[2] + m[3], value: m[4], post: m[5], star: m[5].includes('*') };
      const d = m[4].match(RE.dice);
      if (d) {
        f.kind = 'dice';
        f.die = +d[1];
        f.b1 = (d[2] === '-' ? -1 : 1) * +d[3];
        f.b2 = (d[4] === '-' ? -1 : 1) * +d[5];
        f.auto = f.b1 === Math.floor(f.die / 5);
        const rest = m[4].slice(d[0].length);
        f.suffix = rest.replace(RE.diceTotal, '');
      } else if (RE.num.test(m[4].trim())) {
        f.kind = 'num';
      }
      fields.push(f);
    }
  });
  // ids únicos (caso alguma chave se repita)
  const seen: Record<string, number> = {};
  fields.forEach(f => { if (seen[f.id]) f.id += '#' + (++seen[f.id]); else seen[f.id] = 1; });
  sections.forEach(s => { s.text = lines.slice(s.start, s.end).join('\n'); });
  return { lines, fields, sections };
}

// ---------- número principal de atributos livres ("4d30", "1d25", "+10") ----------
const MAIN_DICE = /^(\s*\d*\s*d\s*)(\d+)/i;
const MAIN_NUM = /^(\s*)([+-]?)(\s*)(\d+)/;

/** Número que os pontos alteram: lados do dado em "4d30"/"1d25", ou o valor em "+10". */
export function mainNumber(value: string): number | null {
  let m = value.match(MAIN_DICE);
  if (m) return +m[2];
  m = value.match(MAIN_NUM);
  if (m) return (m[2] === '-' ? -1 : 1) * +m[4];
  return null;
}

/** Soma `delta` ao número principal (mínimo 0), mantendo o resto do texto. */
export function bumpMain(value: string, delta: number): string | null {
  let m = value.match(MAIN_DICE);
  if (m) return m[1] + Math.max(0, +m[2] + delta) + value.slice(m[0].length);
  m = value.match(MAIN_NUM);
  if (!m) return null;
  const n = Math.max(0, (m[2] === '-' ? -1 : 1) * +m[4] + delta);
  return m[1] + (m[2] ? '+' : '') + m[3] + n + value.slice(m[0].length);
}

// ---------- "Gosta de >>[ a / b / c ]<<" ----------
export const GOSTA_MAX = 5;

/** Separa o valor de "Gosta de" em itens (separados por "/"). */
export function splitGosta(value: string): string[] {
  return value.split('/').map(s => s.trim()).filter(Boolean);
}

/** Junta os itens com " / ", mantendo os espaços do começo e do fim do valor original. */
export function joinGosta(itens: string[], original: string): string {
  const lead = original.match(/^\s*/)![0];
  const trail = original.trim() ? original.match(/\s*$/)![0] : lead;
  // mantém o estilo do original: "a / b" ou "a/b"
  const sep = original.includes('/') && !/\s\/|\/\s/.test(original) ? '/' : ' / ';
  const corpo = itens.map(s => s.replace(/\//g, '-').trim()).filter(Boolean).join(sep);
  return corpo ? lead + corpo + trail : original.trim() ? '' : original;
}

export function diceValue(die: number, b1: number, b2: number): string {
  const t = b1 + b2;
  return `d${die} ( ${sign(b1)} )( ${sign(b2)} ) d${die}${t ? sign(t) : ''}`;
}

function writeField(lines: string[], f: Field): void {
  switch (f.kind) {
    case 'nivel': {
      let l = lines[f.line];
      l = l.replace(/\[\s*\d+\s*\]/, `[${f.nivel}]`);
      if (f.pontos != null) l = l.replace(/\(\s*\+?\s*-?\d+\s*\)(\s*pontos)/i, `(${sign(f.pontos)})$1`);
      if (f.pontosNivel != null) l = l.replace(/\(\s*\+?\s*-?\d+\s*\)(\s*n.vel)/i, `(${sign(f.pontosNivel)})$1`);
      lines[f.line] = l;
      break;
    }
    case 'vital': {
      let post = f.post;
      if (/stress/i.test(f.key)) {
        const s = +f.value || 0;
        post = post.replace(/-\s*\d+(\s*de\s*stat)/i, `-${Math.floor(s / 10)}$1`)
          .replace(/\+\s*\d+(\s*de\s*dano)/i, `+${s}$1`);
      }
      lines[f.line] = f.pre + f.value + post;
      break;
    }
    case 'dice':
      lines[f.line] = f.pre + diceValue(f.die!, f.b1!, f.b2!) + (f.suffix || '') + f.post;
      break;
    default:
      lines[f.line] = f.pre + f.value + f.post;
  }
}

export function findField(sheet: StatusSheet, catPart: string, keyPart: string): Field | undefined {
  const c = norm(catPart), k = norm(keyPart);
  return sheet.fields.find(f => norm(f.cat).includes(c) && norm(f.key).startsWith(k));
}

/** Recalcula regras automáticas; só marca como alterado o que realmente mudou. */
export function applyAuto(sheet: StatusSheet): void {
  sheet.fields.forEach(f => {
    if (f.kind === 'dice' && f.auto && f.dirty) f.b1 = Math.floor(f.die! / 5);
  });
  const setAuto = (f: Field | undefined, v: string) => { if (f && f.value !== v) { f.value = v; f.dirty = true; } };
  const pc = findField(sheet, 'precis', 'corpo a corpo'), pl = findField(sheet, 'precis', 'longo alcan');
  const reac = findField(sheet, 'precis', 'velocidade de rea');
  if (reac && pc && pl && pc.kind === 'dice' && pl.kind === 'dice' && (pc.dirty || pl.dirty)) setAuto(reac, '+' + Math.floor((pc.die! + pl.die!) / 10));
  const ec = findField(sheet, 'destreza', 'esquiva de ataque corpo'), el = findField(sheet, 'destreza', 'esquiva de longo');
  const refl = findField(sheet, 'destreza', 'reflexo');
  if (refl && ec && el && ec.kind === 'dice' && el.kind === 'dice' && (ec.dirty || el.dirty)) setAuto(refl, '+' + Math.floor((ec.die! + el.die!) / 10));
}

/** `auto` aplica as regras automáticas do RPG Dark antes de escrever. */
export function serializeStatus(sheet: StatusSheet, auto = true): string {
  if (auto) applyAuto(sheet);
  const lines = sheet.lines.slice();
  sheet.fields.forEach(f => { if (f.dirty) writeField(lines, f); });
  const out: string[] = [];
  let cursor = 0;
  sheet.sections.forEach(s => {
    out.push(...lines.slice(cursor, s.start));
    out.push(...s.text.split('\n'));
    cursor = s.end;
  });
  out.push(...lines.slice(cursor));
  return out.join('\r\n');
}

// ---------------- ROLL20 ----------------
export function r20(expr: string | null | undefined): string {
  if (!expr) return '';
  let e = String(expr).replace(/\(\s*[A-Za-zÀ-ú][^)]*\)/g, '') // remove "( lâmina )"
    .replace(/\s+/g, '');
  e = e.replace(/(^|[+\-*(])d(\d+)/gi, '$11d$2');
  if (/\bd0\b/i.test(e) && !/[1-9]/.test(e.replace(/d0/gi, ''))) return '';
  return e;
}

export function diceExpr(f: Field | undefined): string {
  if (!f) return '';
  if (f.kind === 'dice') return f.die ? r20(`d${f.die}${f.b1! + f.b2! ? sign(f.b1! + f.b2!) : ''}`) : '';
  if (f.kind === 'num') return String(+f.value.replace(/\s/g, '') || 0);
  const m = String(f.value).match(/^[\sd\d+\-]+/i);
  return m ? r20(m[0]) : '';
}

export function stressValue(sheet: StatusSheet): number {
  return +(sheet.fields.find(f => f.id === 'vital_stress')?.value ?? 0) || 0;
}

export function tokens(sheet: StatusSheet): Tokens {
  applyAuto(sheet);
  const stress = stressValue(sheet);
  const f = (c: string, k: string) => diceExpr(findField(sheet, c, k));
  return {
    prec_cc: f('precis', 'corpo a corpo'),
    prec_la: f('precis', 'longo alcan'),
    reacao: f('precis', 'velocidade de rea'),
    esq_cc: f('destreza', 'esquiva de ataque corpo'),
    esq_la: f('destreza', 'esquiva de longo'),
    reflexo: f('destreza', 'reflexo'),
    corrida: diceExpr(findField(sheet, 'destreza', 'velocidade de corrida') || findField(sheet, 'destreza', 'velocidade')),
    atk_cc: f('atributos de ataque', 'corpo a corpo'),
    atk_la: f('atributos de ataque', 'longo alcan'),
    intimidacao: f('carisma', 'intimid'),
    convencer: f('carisma', 'conven'),
    enganar: f('carisma', 'engan'),
    stress_teste: String(Math.floor(stress / 10)),
    stress_dano: String(stress),
  };
}

/** Monta "/roll ..." a partir de uma fórmula com {tokens}; termos vazios viram 0. */
export function buildRoll(formula: string, t: Partial<Tokens>): string {
  let s = formula.replace(/\{(\w+)\}/g, (_, k: string) => (t[k as keyof Tokens] ? t[k as keyof Tokens]! : '0'));
  s = s.replace(/\s+/g, ' ').trim();
  return '/roll ' + s;
}

/** Remove termos nulos como "- 0[Stress]" para deixar o comando limpo (não muda o resultado). */
export function cleanRoll(cmd: string): string {
  let s = cmd.replace(/\s*[+-]\s*0\s*\[[^\]]*\]/g, '');
  s = s.replace(/^\/roll\s+0\s*\[[^\]]*\]\s*\+\s*/, '/roll ');
  return s.replace(/\s+/g, ' ').trim();
}

/** Dano de arma: "Corpo a corpo + 2d20 + 20". */
export function weaponRoll(dano: string, t: Partial<Tokens>, stressOn: boolean, nome?: string): string {
  let base = '', rest = dano;
  if (/corpo a corpo/i.test(dano)) { base = t.atk_cc || ''; rest = dano.replace(/corpo a corpo/i, ''); }
  else if (/longo alcan/i.test(dano)) { base = t.atk_la || ''; rest = dano.replace(/longo alcan[cs]e/i, ''); }
  rest = r20(rest.replace(/^\s*\+/, ''));
  const parts: string[] = [];
  if (base) parts.push(`${base}[Base]`);
  if (rest) parts.push(`${rest}[${nome || 'Arma'}]`);
  if (stressOn && +(t.stress_dano || 0) > 0) parts.push(`${t.stress_dano}[Stress]`);
  return parts.length ? '/roll ' + parts.join(' + ') : '';
}

// ---------------- MOCHILA ----------------
const MRE = {
  main: /^\s*-=>>\s*(.+?)\s*<<=-\s*$/,
  sub: /^\s*=+\s*\(?\s*([^=()]+?)\s*\)?\s*=+\s*$/,
  conn: /^\s*\|\s*$/,
  attr: /^(\s*\|_?>>\s*)([^=]+?)\s*=\s*(.*?)\s*$/,
};

export function parseMochila(text: string): Mochila {
  const lines = text.replace(/\r/g, '').split('\n');
  const sections: MochilaSection[] = [];
  let sec: MochilaSection = { header: '', title: '(início)', level: 0, items: [] };
  sections.push(sec);
  let item: MochilaItem | null = null;
  let antesVazia = false; // linha anterior em branco
  lines.forEach(line => {
    let m: RegExpMatchArray | null;
    const vazia = !line.trim();
    const anterior = antesVazia;
    antesVazia = vazia;
    if ((m = line.match(MRE.main))) { sec = { header: line, title: m[1], level: 1, items: [] }; sections.push(sec); item = null; return; }
    if ((m = line.match(MRE.sub))) { sec = { header: line, title: m[1], level: 2, items: [] }; sections.push(sec); item = null; return; }
    if (MRE.conn.test(line)) return;
    if (vazia) return;
    if ((m = line.match(MRE.attr)) && item) { item.attrs.push({ pre: m[1], key: m[2].trim(), value: m[3] }); return; }
    // linha indentada logo abaixo do item = nota; depois de linha em branco = item novo (indentado)
    if (/^\s/.test(line) && item && !anterior) { item.notes.push(line); return; }
    item = { name: line.trim(), attrs: [], notes: [] };
    sec.items.push(item);
  });
  if (!sections[0].items.length) sections.shift();
  return { sections, lines, dirty: false };
}

export function serializeMochila(m: Mochila): string {
  if (!m.dirty) return m.lines.join('\r\n');
  const out: string[] = [];
  m.sections.forEach(s => {
    if (s.header) out.push(s.header, '');
    s.items.forEach(it => {
      out.push(it.name);
      const ind = (it.attrs[0] && it.attrs[0].pre.match(/^\s*/)![0]) || '        ';
      it.attrs.forEach((a, i) => {
        const pre = a.pre || (ind + (i === it.attrs.length - 1 ? '|_>> ' : '|>> '));
        out.push(ind + '|', pre + a.key + ' = ' + a.value);
      });
      it.notes.forEach(n => out.push(n));
      out.push('');
    });
    if (!s.items.length) out.push('');
  });
  return out.join('\r\n');
}

const kg = (s: string | undefined): number => {
  const m = String(s || '').match(/(\d+(?:[.,]\d+)?)\s*kg/i);
  return m ? parseFloat(m[1].replace(',', '.')) : 0;
};

export function itemWeight(it: MochilaItem): { qty: number; unit: number; total: number } {
  const q = it.name.match(/^\s*(\d+)\s*(?:x\b|\/\s*\d+|-\s)/i);
  const qty = q ? +q[1] : 1;
  const pa = it.attrs.find(a => norm(a.key) === 'peso');
  const w = pa ? kg(pa.value) : kg(it.name);
  return { qty, unit: w, total: w * qty };
}

export function carryLimit(sheet: StatusSheet): number {
  const f = findField(sheet, 'atributos de ataque', 'levantamento');
  if (!f) return 0;
  const m = String(f.kind === 'dice' ? (f.suffix || f.value) : f.value).match(/at.\s*(\d+(?:[.,]\d+)?)\s*kg/i);
  return m ? parseFloat(m[1].replace(',', '.')) : 0;
}

export function detectType(text: string): 'mochila' | 'status' | null {
  if (/-=>>\s*Mochila\s*<<=-/i.test(text)) return 'mochila';
  if (/\[\s*HP\s*\]|=\[\s*N.vel/i.test(text)) return 'status';
  return null;
}

/** Tenta UTF-8 estrito; se falhar, Windows-1252. */
export function decode(buf: ArrayBuffer | Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { return new TextDecoder('windows-1252').decode(buf); }
}

@Injectable({ providedIn: 'root' })
export class FichaParserService {
  readonly norm = norm;
  readonly parseStatus = parseStatus;
  readonly serializeStatus = serializeStatus;
  readonly applyAuto = applyAuto;
  readonly diceValue = diceValue;
  readonly find = findField;
  readonly tokens = tokens;
  readonly buildRoll = buildRoll;
  readonly cleanRoll = cleanRoll;
  readonly weaponRoll = weaponRoll;
  readonly parseMochila = parseMochila;
  readonly serializeMochila = serializeMochila;
  readonly itemWeight = itemWeight;
  readonly carryLimit = carryLimit;
  readonly detectType = detectType;
  readonly decode = decode;
  readonly r20 = r20;
  readonly stressValue = stressValue;
}
