import { detectStatusCibo, parseStatusCibo, statusTemplateCibo } from './cibo-parser';
import { joinGosta, parseMochila, serializeMochila, serializeStatus, splitGosta } from './ficha-parser.service';
import { SISTEMAS } from './sistemas';

// Ficha inventada, só com o formato do RPG Cibo.
const STATUS = [
  '===== >> STATUS << =====',
  'Status >> Geral começa com 20 ( 3 pontos)',
  '',
  'Personalidade = Calmo',
  'Nome = Teste',
  'Gosta de [ até 5 coisas ] = (Chá/Livros)',
  '',
  '=====================================',
  '[ HP ] = 100 (+10) = 110',
  '[ Energia ] = 50',
  '',
  'Defesa Física = 10 (+5) = 15',
  'Defesa Elemental = 5',
  '    |',
  '    |_>> Isolante Termico =',
  '',
  '[= Resistências =]',
  '    |',
  '    |_>> ',
  '',
  '[= Acerto =] ( 12 )',
  '    |',
  '    |_>> Precisão Corpo a Corpo = 10 ( +2 ) = 24%',
  '    |',
  '    |_>> Precisão Longo alcance = d20',
  '',
  '==============[ Passivas ]==============',
  '',
  '[x] Algo = efeito',
  '    |',
  '    |_>> Detalhe = não é campo',
  '',
].join('\r\n');

describe('RPG Cibo — ficha', () => {
  it('reconhece e exporta idêntico', () => {
    expect(detectStatusCibo(STATUS)).toBe(true);
    expect(serializeStatus(parseStatusCibo(STATUS), false)).toBe(STATUS);
    const t = statusTemplateCibo('Novo');
    expect(serializeStatus(parseStatusCibo(t), false)).toBe(t);
  });

  it('lê identidade, vitais, categorias e seções', () => {
    const s = parseStatusCibo(STATUS);
    const v = (id: string) => s.fields.find(f => f.id === id)?.value;
    expect(v('pontos')).toBe('3');
    expect(v('id_nome')).toBe('Teste');
    expect(v('gosta')).toBe('Chá/Livros');
    expect(v('vital_hp')).toBe('100 (+10) = 110');
    expect(v('geral|defesa fisica')).toBe('10 (+5) = 15');
    expect(v('acerto|__total')).toBe('12');
    expect(v('acerto|precisao corpo a corpo')).toBe('10 ( +2 ) = 24%');
    expect(s.fields.find(f => f.key === 'Isolante Termico')?.cat).toBe('Defesa Elemental');
    expect(s.fields.find(f => f.cat === 'Resistências')?.key).toBe('•');
    expect(s.sections.map(x => x.title)).toEqual(['Passivas']);
    // texto dentro de seção livre não vira campo
    expect(s.fields.some(f => f.key === 'Detalhe')).toBe(false);
  });

  it('reescreve só as linhas editadas', () => {
    const s = parseStatusCibo(STATUS);
    const f = s.fields.find(x => x.id === 'acerto|precisao corpo a corpo')!;
    f.value = '11 ( +2 ) = 26%';
    f.dirty = true;
    const g = s.fields.find(x => x.id === 'gosta')!;
    g.value = joinGosta([...splitGosta(g.value), 'Sol'], g.value);
    g.dirty = true;
    const out = serializeStatus(s, false).split('\r\n');
    const orig = STATUS.split('\r\n');
    expect(out[22]).toBe('    |_>> Precisão Corpo a Corpo = 11 ( +2 ) = 26%');
    expect(out[5]).toBe('Gosta de [ até 5 coisas ] = (Chá/Livros/Sol)'); // mantém o "/" sem espaços
    expect(out.filter((l, i) => l !== orig[i]).length).toBe(2);
  });

  it('cada RPG tem regras e nomes de arquivo próprios', () => {
    const [dark, cibo] = SISTEMAS;
    expect(dark.arquivo('status', 'X')).toBe('Status_X.txt');
    expect(cibo.arquivo('status', 'X')).toBe('STATUS.X.txt');
    expect(cibo.arquivo('mochila', 'X')).toBe('Mochila.X.txt');
    expect(cibo.formulasPadrao).toEqual([]);
    expect(dark.formulasPadrao.length).toBeGreaterThan(0);
  });
});

describe('Mochila com itens indentados', () => {
  const M = [
    '-=>>Armas<<=-',
    '',
    '    Item A',
    '      |',
    '      |>> Dano = 2d6',
    '',
    '',
    '   Item B',
    '      |',
    '      |>> Dano = 1d4',
    '   nota do item B',
    '',
  ].join('\r\n');
  it('linha indentada depois de linha em branco é item novo', () => {
    const m = parseMochila(M);
    expect(m.sections[0].items.map(i => i.name)).toEqual(['Item A', 'Item B']);
    expect(m.sections[0].items[1].notes).toEqual(['   nota do item B']);
    expect(serializeMochila(m)).toBe(M);
  });
});
