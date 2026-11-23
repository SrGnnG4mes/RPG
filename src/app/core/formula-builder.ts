import { Tokens } from './ficha-parser.service';

/** Atributos que podem entrar numa rolagem, com o rótulo mostrado e usado no /roll. */
export const ATRIBUTOS: { token: keyof Tokens; nome: string; rotulo: string }[] = [
  { token: 'prec_cc', nome: 'Precisão CC', rotulo: 'Precisão CC' },
  { token: 'prec_la', nome: 'Precisão LA', rotulo: 'Precisão LA' },
  { token: 'esq_cc', nome: 'Esquiva CC', rotulo: 'Esquiva CC' },
  { token: 'esq_la', nome: 'Esquiva LA', rotulo: 'Esquiva LA' },
  { token: 'corrida', nome: 'Velocidade de corrida', rotulo: 'Velocidade' },
  { token: 'reacao', nome: 'Velocidade de reação', rotulo: 'Reação' },
  { token: 'reflexo', nome: 'Reflexo', rotulo: 'Reflexo' },
  { token: 'atk_cc', nome: 'Ataque CC', rotulo: 'Ataque CC' },
  { token: 'atk_la', nome: 'Ataque LA', rotulo: 'Ataque LA' },
  { token: 'intimidacao', nome: 'Intimidação', rotulo: 'Intimidação' },
  { token: 'convencer', nome: 'Convencer', rotulo: 'Convencer' },
  { token: 'enganar', nome: 'Enganar', rotulo: 'Enganar' },
];

export type ModoStress = 'nenhum' | 'teste' | 'dano';
export type Arredondar = 'floor' | 'round' | 'ceil';

export interface Termo {
  sinal: '+' | '-';
  tipo: 'atributo' | 'numero' | 'dado';
  /** token do atributo, número ("5") ou dado ("2d6") */
  valor: string;
  rotulo?: string;
}

/** Rolagem montada pelo seletor (guardada junto da fórmula para reabrir igual). */
export interface Montagem {
  termos: Termo[];
  stress: ModoStress;
  /** % sobre o resultado final (ex.: 5 → × 1.05); 0 = sem multiplicador */
  percentual: number;
  arredondar: Arredondar;
}

export const montagemVazia = (): Montagem => ({ termos: [], stress: 'teste', percentual: 0, arredondar: 'floor' });

const rotuloDe = (t: Termo): string =>
  t.rotulo?.trim() || (t.tipo === 'atributo' ? ATRIBUTOS.find(a => a.token === t.valor)?.rotulo ?? t.valor : '');

/** Normaliza "d6"/"2D6" → "1d6"/"2d6"; retorna '' se não for um dado válido. */
export function normalizarDado(v: string): string {
  const m = v.trim().match(/^(\d*)\s*d\s*(\d+)$/i);
  return m ? `${m[1] || '1'}d${m[2]}` : '';
}

/** Fator do percentual: 5 → "1.05", -10 → "0.9". */
export function fator(percentual: number): string {
  return String(Math.round((1 + percentual / 100) * 10000) / 10000);
}

/** Envolve a expressão em floor/round/ceil((...) * fator) quando há percentual. */
export function aplicarPercentual(expr: string, percentual: number, arredondar: Arredondar = 'floor'): string {
  if (!expr.trim() || !percentual) return expr;
  return `${arredondar}((${expr}) * ${fator(percentual)})`;
}

/** Monta a fórmula (com {tokens}) a partir da montagem. */
export function montarFormula(m: Montagem): string {
  const partes: string[] = [];
  m.termos.forEach(t => {
    let corpo = '';
    if (t.tipo === 'atributo') corpo = ATRIBUTOS.some(a => a.token === t.valor) ? `{${t.valor}}` : '';
    else if (t.tipo === 'dado') corpo = normalizarDado(t.valor);
    else corpo = /^\d+$/.test(t.valor.trim()) ? t.valor.trim() : '';
    if (!corpo) return;
    const rot = rotuloDe(t);
    const termo = corpo + (rot ? `[${rot}]` : '');
    partes.push(partes.length ? ` ${t.sinal} ${termo}` : (t.sinal === '-' ? '-' : '') + termo);
  });
  let f = partes.join('');
  if (!f) return '';
  if (m.stress === 'teste') f += ' - {stress_teste}[Stress]';
  if (m.stress === 'dano') f += ' + {stress_dano}[Stress]';
  return aplicarPercentual(f, m.percentual, m.arredondar);
}

/**
 * Tenta ler uma fórmula escrita como montagem (termos somados/subtraídos, Stress no fim,
 * percentual opcional). Retorna null se ela usa algo que o seletor não representa.
 */
export function lerFormula(formula: string): Montagem | null {
  let f = formula.trim();
  const m: Montagem = { termos: [], stress: 'nenhum', percentual: 0, arredondar: 'floor' };
  if (!f) return montagemVazia();
  const w = f.match(/^(floor|round|ceil)\(\((.*)\)\s*\*\s*(\d+(?:\.\d+)?)\)$/);
  if (w) {
    m.arredondar = w[1] as Arredondar;
    f = w[2].trim();
    m.percentual = Math.round((+w[3] - 1) * 10000) / 100;
  }
  const termos = f.split(/\s+(?=[+-]\s)/).map(t => t.trim());
  for (let i = 0; i < termos.length; i++) {
    const x = termos[i].match(/^([+-]?)\s*(?:\{(\w+)\}|(\d*d\d+)|(\d+))(?:\[([^\]]*)\])?$/i);
    if (!x) return null;
    const [, s, token, dado, num, rotulo] = x;
    const sinal = (s || '+') as '+' | '-';
    const ultimo = i === termos.length - 1;
    if (token === 'stress_teste' && sinal === '-' && ultimo && i > 0) { m.stress = 'teste'; continue; }
    if (token === 'stress_dano' && sinal === '+' && ultimo && i > 0) { m.stress = 'dano'; continue; }
    if (i === 0 && s === '+') return null;
    if (token) {
      const a = ATRIBUTOS.find(y => y.token === token);
      if (!a) return null;
      m.termos.push({ sinal, tipo: 'atributo', valor: token, ...(rotulo && rotulo !== a.rotulo ? { rotulo } : {}) });
    } else if (dado) {
      m.termos.push({ sinal, tipo: 'dado', valor: normalizarDado(dado), ...(rotulo ? { rotulo } : {}) });
    } else {
      m.termos.push({ sinal, tipo: 'numero', valor: num, ...(rotulo ? { rotulo } : {}) });
    }
  }
  return m;
}

/** Explica a notação em português, ex.: "(…) × 1.05, arredondado para baixo". */
export function explicarPercentual(percentual: number, arredondar: Arredondar): string {
  if (!percentual) return '';
  const nome = { floor: 'para baixo', round: 'para o mais próximo', ceil: 'para cima' }[arredondar];
  return `Resultado final ${percentual > 0 ? '+' : ''}${percentual}% (× ${fator(percentual)}), arredondado ${nome}.`;
}
