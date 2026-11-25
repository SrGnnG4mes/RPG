import {
  Mochila, StatusSheet, Tokens, buildRoll, carryLimit, cleanRoll, itemWeight, norm, tokens, weaponRoll,
} from './ficha-parser.service';
import { aplicarPercentual, montarFormula } from './formula-builder';
import { AppConfig, DEFAULT_FORMULAS, Formula } from './models';

export interface Rolagem { chave: string; nome: string; cmd: string; grupo: string; arma?: boolean }

/** Ordem em que os grupos aparecem na lista. */
export const GRUPOS = ['Precisão', 'Esquiva', 'Velocidade', 'Dano', 'Armas', 'Carisma', 'Minhas rolagens'];
const GRUPO_TOKEN: Record<string, string> = {
  prec_cc: 'Precisão', prec_la: 'Precisão', esq_cc: 'Esquiva', esq_la: 'Esquiva', corrida: 'Velocidade',
  atk_cc: 'Dano', atk_la: 'Dano', intimidacao: 'Carisma', convencer: 'Carisma', enganar: 'Carisma',
};

/** Só as rolagens básicas (iguais às padrão) ganham grupo; as criadas pelo jogador ficam em "Minhas rolagens". */
export function grupoDa(f: Formula): string {
  if (!DEFAULT_FORMULAS.some(d => d.formula === f.formula)) return 'Minhas rolagens';
  const token = f.formula.match(/\{(\w+)\}/)?.[1] ?? '';
  return GRUPO_TOKEN[token] ?? 'Minhas rolagens';
}

/** Tokens com os liga/desliga de Stress aplicados. */
export function tokensComConfig(sheet: StatusSheet, cfg: AppConfig): Tokens {
  const t = tokens(sheet);
  if (!cfg.stressTeste) t.stress_teste = '';
  if (!cfg.stressDano) t.stress_dano = '';
  return t;
}

export function rolagens(sheet: StatusSheet, mochila: Mochila | null, cfg: AppConfig, comArmas = true): Rolagem[] {
  const t = tokensComConfig(sheet, cfg);
  const out: Rolagem[] = cfg.formulas.map(f => ({
    chave: 'f:' + f.nome, nome: f.nome, grupo: grupoDa(f), cmd: cleanRoll(buildRoll(formulaComPassivas(f, cfg), t)),
  }));
  if (comArmas) armas(mochila).forEach(a => {
    const cmd = weaponRoll(a.dano, t, cfg.stressDano, a.nome);
    if (!cmd) return;
    const pct = /corpo a corpo/i.test(a.dano) ? cfg.pctDanoCC ?? 0 : /longo alcan/i.test(a.dano) ? cfg.pctDanoLA ?? 0 : 0;
    out.push({ chave: 'a:' + a.nome, nome: a.nome, grupo: 'Armas', cmd: '/roll ' + aplicarPercentual(cmd.replace(/^\/roll\s+/, ''), pct), arma: true });
  });
  return out;
}

export function armas(mochila: Mochila | null): { nome: string; dano: string }[] {
  if (!mochila) return [];
  const r: { nome: string; dano: string }[] = [];
  mochila.sections.forEach(s => s.items.forEach(it => {
    const d = it.attrs.find(a => norm(a.key) === 'dano');
    if (d && d.value.trim()) r.push({ nome: it.name, dano: d.value });
  }));
  return r;
}

export function carga(sheet: StatusSheet, mochila: Mochila | null): { total: number; limite: number; excesso: number } {
  let total = 0;
  mochila?.sections.forEach(s => s.items.forEach(it => { total += itemWeight(it).total; }));
  total = Math.round(total * 100) / 100;
  const limite = carryLimit(sheet);
  const excesso = limite > 0 ? Math.max(0, Math.ceil(total - limite)) : 0;
  return { total, limite, excesso };
}

/** % das passivas de dano que valem para a fórmula (usa Ataque CC e/ou LA). */
export function pctPassivas(formula: string, cfg: AppConfig): number {
  return (formula.includes('{atk_cc}') ? cfg.pctDanoCC ?? 0 : 0) + (formula.includes('{atk_la}') ? cfg.pctDanoLA ?? 0 : 0);
}

/** Fórmula final: a montagem com o % próprio + o das passivas (somados), ou a escrita à mão envolvida. */
export function formulaComPassivas(f: Formula, cfg: AppConfig): string {
  const pct = pctPassivas(f.formula, cfg);
  if (f.montagem) return montarFormula({ ...f.montagem, percentual: (f.montagem.percentual || 0) + pct });
  return aplicarPercentual(f.formula, pct);
}
