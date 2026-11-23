export interface FichaDoc {
  id: string;
  nome: string;
  /** texto do Status_*.txt (CRLF) */
  status: string;
  /** texto do Mochila_*.txt (CRLF) */
  mochila: string;
}

import type { Montagem } from './formula-builder';

export interface Formula {
  nome: string;
  formula: string;
  /** como foi montada no seletor (ausente = escrita à mão) */
  montagem?: Montagem;
}

export interface AppConfig {
  formulas: Formula[];
  stressTeste: boolean;
  stressDano: boolean;
  /** chaves das rolagens favoritas ("f:<nome>" fórmula, "a:<nome>" arma) */
  favoritas?: string[];
  /** passivas: % no resultado final do dano corpo a corpo / longo alcance */
  pctDanoCC?: number;
  pctDanoLA?: number;
}

// Tokens: prec_cc, prec_la, esq_cc, esq_la, corrida, reacao, reflexo, atk_cc, atk_la,
// intimidacao, convencer, enganar, stress_teste, stress_dano
// Rolagens padrão: uma por atributo. O jogador cria as próprias em "Editar fórmulas".
export const DEFAULT_FORMULAS: Formula[] = [
  { nome: 'Precisão CC', formula: '{prec_cc}[Precisão CC] - {stress_teste}[Stress]' },
  { nome: 'Precisão LA', formula: '{prec_la}[Precisão LA] - {stress_teste}[Stress]' },
  { nome: 'Esquiva CC', formula: '{esq_cc}[Esquiva CC] - {stress_teste}[Stress]' },
  { nome: 'Esquiva LA', formula: '{esq_la}[Esquiva LA] - {stress_teste}[Stress]' },
  { nome: 'Velocidade de corrida', formula: '{corrida}[Velocidade] - {stress_teste}[Stress]' },
  { nome: 'Dano CC', formula: '{atk_cc}[Ataque CC] + {stress_dano}[Stress]' },
  { nome: 'Dano LA', formula: '{atk_la}[Ataque LA] + {stress_dano}[Stress]' },
  { nome: 'Intimidação', formula: '{intimidacao}[Intimidação] - {stress_teste}[Stress]' },
  { nome: 'Convencer', formula: '{convencer}[Convencer] - {stress_teste}[Stress]' },
  { nome: 'Enganar', formula: '{enganar}[Enganar] - {stress_teste}[Stress]' },
];

export const DEFAULT_CONFIG: AppConfig = {
  formulas: DEFAULT_FORMULAS,
  stressTeste: true,
  stressDano: true,
  favoritas: [],
  pctDanoCC: 0,
  pctDanoLA: 0,
};
