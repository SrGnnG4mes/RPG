import { detectStatusCibo, parseStatusCibo, statusTemplateCibo } from './cibo-parser';
import { StatusSheet, applyAuto, parseStatus, serializeStatus } from './ficha-parser.service';
import { ATRIBUTOS } from './formula-builder';
import { DEFAULT_FORMULAS, Formula } from './models';
import { statusTemplate } from './templates';

export type SistemaId = 'dark' | 'cibo';

/** O que muda de um RPG para outro: formato da ficha, regras e rolagens. */
export interface Sistema {
  id: SistemaId;
  nome: string;
  descricao: string;
  parseStatus(text: string): StatusSheet;
  serializeStatus(sheet: StatusSheet): string;
  /** regras automáticas aplicadas a cada edição */
  aplicarRegras(sheet: StatusSheet): void;
  statusTemplate(nome: string): string;
  ehStatus(text: string): boolean;
  /** nome do arquivo exportado */
  arquivo(tipo: 'status' | 'mochila', nome: string): string;
  /** atributos que o montador de rolagens oferece */
  atributos: typeof ATRIBUTOS;
  formulasPadrao: Formula[];
  /** gera rolagem de dano para as armas da mochila */
  armasNoRoll: boolean;
  /** mostra as passivas de % no dano CC/LA */
  passivasDano: boolean;
}

export const SISTEMAS: Sistema[] = [
  {
    id: 'dark',
    nome: 'RPG Dark',
    descricao: 'Fichas Status_Nome.txt e Mochila_Nome.txt',
    parseStatus,
    serializeStatus: s => serializeStatus(s),
    aplicarRegras: applyAuto,
    statusTemplate,
    ehStatus: t => /\[\s*HP\s*\]|=\[\s*N.vel/i.test(t),
    arquivo: (tipo, nome) => `${tipo === 'status' ? 'Status' : 'Mochila'}_${nome}.txt`,
    atributos: ATRIBUTOS,
    formulasPadrao: DEFAULT_FORMULAS,
    armasNoRoll: true,
    passivasDano: true,
  },
  {
    id: 'cibo',
    nome: 'RPG Cibo',
    descricao: 'Fichas STATUS.Nome.txt e Mochila.Nome.txt',
    parseStatus: parseStatusCibo,
    serializeStatus: s => serializeStatus(s, false),
    aplicarRegras: () => {},
    statusTemplate: statusTemplateCibo,
    ehStatus: detectStatusCibo,
    arquivo: (tipo, nome) => `${tipo === 'status' ? 'STATUS' : 'Mochila'}.${nome}.txt`,
    atributos: [],
    formulasPadrao: [],
    armasNoRoll: false,
    passivasDano: false,
  },
];

export const sistemaPorId = (id: string | null | undefined): Sistema | null => SISTEMAS.find(s => s.id === id) ?? null;
