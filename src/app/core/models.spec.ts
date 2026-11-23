import { DEFAULT_FORMULAS } from './models';

describe('Fórmulas padrão', () => {
  it('cada rolagem padrão usa um único atributo', () => {
    for (const f of DEFAULT_FORMULAS) {
      const atributos = (f.formula.match(/\{(\w+)\}/g) ?? []).filter(t => !t.startsWith('{stress'));
      expect(atributos.length).toBe(1);
    }
  });
});

import { grupoDa } from './rolagens';

describe('Grupos das rolagens', () => {
  it('só as básicas ganham grupo; as criadas ficam em "Minhas rolagens"', () => {
    const grupo = (nome: string) => grupoDa(DEFAULT_FORMULAS.find(f => f.nome === nome)!);
    expect(grupo('Precisão CC')).toBe('Precisão');
    expect(grupo('Esquiva LA')).toBe('Esquiva');
    expect(grupo('Velocidade de corrida')).toBe('Velocidade');
    expect(grupo('Dano CC')).toBe('Dano');
    expect(grupo('Convencer')).toBe('Carisma');
    expect(grupoDa({ nome: 'Minha', formula: '{esq_cc}[Esquiva CC] + 2' })).toBe('Minhas rolagens');
  });
});
