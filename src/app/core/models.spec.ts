import { DEFAULT_FORMULAS } from './models';

describe('Fórmulas padrão', () => {
  it('cada rolagem padrão usa um único atributo', () => {
    for (const f of DEFAULT_FORMULAS) {
      const atributos = (f.formula.match(/\{(\w+)\}/g) ?? []).filter(t => !t.startsWith('{stress'));
      expect(atributos.length).toBe(1);
    }
  });
});
