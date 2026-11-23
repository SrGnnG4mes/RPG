import { DEFAULT_FORMULAS } from './models';
import { ATRIBUTOS, Montagem, aplicarPercentual, lerFormula, montarFormula, normalizarDado } from './formula-builder';

const m = (x: Partial<Montagem>): Montagem => ({ termos: [], stress: 'nenhum', percentual: 0, arredondar: 'floor', ...x });

describe('Montador de fórmulas', () => {
  it('monta termos com sinal, número e dado', () => {
    expect(montarFormula(m({ termos: [{ sinal: '+', tipo: 'atributo', valor: 'prec_cc' }], stress: 'teste' })))
      .toBe('{prec_cc}[Precisão CC] - {stress_teste}[Stress]');
    expect(montarFormula(m({ termos: [
      { sinal: '+', tipo: 'atributo', valor: 'atk_cc' },
      { sinal: '+', tipo: 'dado', valor: 'd6', rotulo: 'Extra' },
      { sinal: '-', tipo: 'numero', valor: '2' },
    ], stress: 'dano' }))).toBe('{atk_cc}[Ataque CC] + 1d6[Extra] - 2 + {stress_dano}[Stress]');
    expect(montarFormula(m({ termos: [{ sinal: '-', tipo: 'numero', valor: '3' }] }))).toBe('-3');
    expect(montarFormula(m({ stress: 'teste' }))).toBe('');
  });

  it('aplica % no resultado final com parênteses e arredondamento', () => {
    expect(montarFormula(m({ termos: [{ sinal: '+', tipo: 'atributo', valor: 'atk_cc' }], stress: 'dano', percentual: 5 })))
      .toBe('floor(({atk_cc}[Ataque CC] + {stress_dano}[Stress]) * 1.05)');
    expect(aplicarPercentual('4d30', -10, 'ceil')).toBe('ceil((4d30) * 0.9)');
    expect(aplicarPercentual('4d30', 0)).toBe('4d30');
  });

  it('lê de volta o que montou e as fórmulas padrão', () => {
    const todos = ATRIBUTOS.map(a => ({ sinal: '+' as const, tipo: 'atributo' as const, valor: a.token as string }));
    for (const stress of ['nenhum', 'teste', 'dano'] as const) {
      const x = m({ termos: [...todos, { sinal: '-', tipo: 'numero', valor: '4' }, { sinal: '+', tipo: 'dado', valor: '2d6' }], stress, percentual: 12.5, arredondar: 'round' });
      expect(lerFormula(montarFormula(x))).toEqual(x);
    }
    for (const f of DEFAULT_FORMULAS) expect(lerFormula(f.formula)).not.toBeNull();
  });

  it('não reconhece fórmulas escritas à mão em outro formato', () => {
    expect(lerFormula('{prec_cc}[A] * 2')).toBeNull();
    expect(lerFormula('({prec_cc}[A] + 2) / 2')).toBeNull();
    expect(lerFormula('{desconhecido}[A]')).toBeNull();
  });

  it('normaliza dados', () => {
    expect(normalizarDado('d6')).toBe('1d6');
    expect(normalizarDado('2D20')).toBe('2d20');
    expect(normalizarDado('abc')).toBe('');
  });
});
