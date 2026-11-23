import {
  buildRoll, carryLimit, cleanRoll, decode, detectType, findField, itemWeight, joinGosta, splitGosta, mainNumber, bumpMain,
  parseMochila, parseStatus, serializeMochila, serializeStatus, tokens, weaponRoll,
} from './ficha-parser.service';
import { mochilaTemplate, statusTemplate } from './templates';

// Ficha sintética no formato das fichas reais (inclui espaços "estranhos" de propósito).
export const STATUS_EXEMPLO = [
  '=[ Nível ]= [7] (+3) pontos (+5) nível',
  '-=>> Exp = 120/700',
  '-=>> Resets = [1] usados',
  'Nome: Exemplo',
  'Idade = 25',
  'Raça: Humano',
  'Gosta de >>[Espadas, chuva]<<',
  '',
  '[ HP ] = 150   ',
  '[ Energia ] = 80',
  '[ Stress ] = 30 ( -3 de status nos testes / +30 de dano )',
  '',
  '[ -- Precisão -- ]',
  '  |>> Corpo a corpo = d20 ( +4 )( +0 ) d20+4',
  '  |>> Longo alcance = d15 ( +3 )( +1 ) d15+4 *',
  '  |_>> Velocidade de reação = +3',
  '[ -- Destreza -- ]',
  '  |>> Esquiva de ataque corpo a corpo = d20 ( +4 )( +0 ) d20+4',
  '  |>> Esquiva de longo alcance = d10 ( +1 )( +0 ) d10+1',
  '  |>> Reflexo = +3',
  '  |_>> Velocidade de corrida = d25 ( +5 )( +0 ) d25+5',
  '[ -- Atributos de ataque -- ]',
  '  |>> Corpo a corpo = d30 ( +6 )( +2 ) d30+8',
  '  |>> Longo alcance = d10 ( +2 )( +0 ) d10+2',
  '  |_>> Levantamento de peso = d20 ( +4 )( +0 ) d20+4 até 40 kg',
  '[ -- Carisma -- ]',
  '  |>> Intimidação = d10 ( +2 )( +0 ) d10+2',
  '  |>> Convencer = 3',
  '  |_>> Enganar = d0 ( +0 )( +0 ) d0',
  'Defesa',
  '  |_>> Armadura = 5',
  '',
  '=====>> Habilidades <<=====',
  'Golpe duplo: ataca duas vezes.',
  '   (custa 10 de energia)',
  '',
  '=====>> Passivas <<=====',
  'Pele grossa',
  '',
].join('\r\n');

export const MOCHILA_EXEMPLO = [
  '-=>> Mochila <<=-',
  '',
  'Espada longa',
  '        |',
  '        |>> Dano = Corpo a corpo + 2d20 + 20',
  '        |',
  '        |_>> Peso = 3 kg',
  '',
  '2x Poção de cura',
  '        |',
  '        |_>> Peso = 0,5 kg',
  '   cura 50 de HP',
  '',
  '=== ( Equipados ) ===',
  '',
  'Arco curto',
  '        |',
  '        |>> Dano = Longo alcance + d12 (perfurante)',
  '        |',
  '        |_>> Peso = 40 kg',
  '',
].join('\r\n');

describe('FichaParser — status', () => {
  it('exporta idêntico quando nada muda', () => {
    expect(serializeStatus(parseStatus(STATUS_EXEMPLO))).toBe(STATUS_EXEMPLO);
    const t = statusTemplate('Novo');
    expect(serializeStatus(parseStatus(t))).toBe(t);
  });

  it('converte LF para CRLF', () => {
    const lf = STATUS_EXEMPLO.replace(/\r\n/g, '\n');
    expect(serializeStatus(parseStatus(lf))).toBe(STATUS_EXEMPLO);
  });

  it('reconhece campos', () => {
    const s = parseStatus(STATUS_EXEMPLO);
    const nivel = s.fields.find(f => f.kind === 'nivel')!;
    expect([nivel.nivel, nivel.pontos, nivel.pontosNivel]).toEqual([7, 3, 5]);
    const pc = findField(s, 'precis', 'corpo a corpo')!;
    expect([pc.kind, pc.die, pc.b1, pc.b2, pc.auto]).toEqual(['dice', 20, 4, 0, true]);
    expect(findField(s, 'destreza', 'esquiva de longo')!.auto).toBe(false); // d10 com b1=1 → manual
    expect(s.sections.map(x => x.title)).toEqual(['Habilidades', 'Passivas']);
    expect(carryLimit(s)).toBe(40);
  });

  it('reescreve só as linhas editadas e aplica regras automáticas', () => {
    const s = parseStatus(STATUS_EXEMPLO);
    const pc = findField(s, 'precis', 'corpo a corpo')!;
    pc.die = 25; pc.dirty = true;
    const lev = findField(s, 'atributos', 'levantamento')!;
    lev.b2 = 1; lev.dirty = true;
    const stress = s.fields.find(f => f.id === 'vital_stress')!;
    stress.value = '45'; stress.dirty = true;
    const out = serializeStatus(s).split('\r\n');
    const orig = STATUS_EXEMPLO.split('\r\n');
    expect(out[13]).toBe('  |>> Corpo a corpo = d25 ( +5 )( +0 ) d25+5');
    expect(out[15]).toBe('  |_>> Velocidade de reação = +4'); // floor((25+15)/10)
    expect(out[24]).toBe('  |_>> Levantamento de peso = d20 ( +4 )( +1 ) d20+5 até 40 kg');
    expect(out[10]).toBe('[ Stress ] = 45 ( -4 de status nos testes / +45 de dano )');
    const changed = out.map((l, i) => (l !== orig[i] ? i : -1)).filter(i => i >= 0);
    expect(changed).toEqual([10, 13, 15, 24]);
  });

  it('edita seção livre sem mexer no resto', () => {
    const s = parseStatus(STATUS_EXEMPLO);
    s.sections[1].text = 'Pele grossa\nVisão noturna\n';
    const out = serializeStatus(s);
    expect(out.endsWith('=====>> Passivas <<=====\r\nPele grossa\r\nVisão noturna\r\n')).toBe(true);
  });
});

describe('FichaParser — Gosta de', () => {
  const v = ' Ajudar pessoas / Destruir símbolos / Caminhar sozinho / Bater em orfão. ( tapa na nuca )  ';
  it('separa e junta sem alterar o formato', () => {
    const itens = splitGosta(v);
    expect(itens).toEqual(['Ajudar pessoas', 'Destruir símbolos', 'Caminhar sozinho', 'Bater em orfão. ( tapa na nuca )']);
    expect(joinGosta(itens, v)).toBe(v);
  });
  it('acrescenta, remove vazios e grava na linha', () => {
    expect(joinGosta(['A', '', 'B', 'C/D'], v)).toBe(' A / B / C-D  ');
    expect(joinGosta(['Espadas'], '')).toBe('Espadas');
    expect(joinGosta(['', ''], ' x ')).toBe('');
    const s = parseStatus(STATUS_EXEMPLO);
    const g = s.fields.find(f => f.id === 'gosta')!;
    g.value = joinGosta([...splitGosta(g.value), 'Sol'], g.value);
    g.dirty = true;
    expect(serializeStatus(s).split('\r\n')[6]).toBe('Gosta de >>[Espadas, chuva / Sol]<<');
  });
});

describe('FichaParser — atributos com *', () => {
  it('lê e altera o número principal', () => {
    expect(mainNumber('4d30')).toBe(30);
    expect(mainNumber('1d25')).toBe(25);
    expect(mainNumber('+10')).toBe(10);
    expect(mainNumber('105kg ( 105kg ) até 234kg')).toBe(105);
    expect(mainNumber('???')).toBeNull();
    expect(bumpMain('4d30', 1)).toBe('4d31');
    expect(bumpMain('1d2', -1)).toBe('1d1');
    expect(bumpMain('+10', 1)).toBe('+11');
    expect(bumpMain('+0', -1)).toBe('+0');
    expect(bumpMain('3', 2)).toBe('5');
  });
  it('marca os atributos com *', () => {
    const s = parseStatus(STATUS_EXEMPLO);
    expect(findField(s, 'precis', 'longo alcan')!.star).toBe(true);
    expect(findField(s, 'precis', 'velocidade de rea')!.star).toBe(false);
  });
});

describe('FichaParser — rolagens', () => {
  it('gera tokens e comandos', () => {
    const t = tokens(parseStatus(STATUS_EXEMPLO));
    expect(t.prec_cc).toBe('1d20+4');
    expect(t.corrida).toBe('1d25+5');
    expect(t.reacao).toBe('3');
    expect(t.convencer).toBe('3');
    expect(t.enganar).toBe('');
    expect(t.stress_teste).toBe('3');
    expect(buildRoll('{prec_cc}[Precisão CC] - {stress_teste}[Stress]', t))
      .toBe('/roll 1d20+4[Precisão CC] - 3[Stress]');
    expect(cleanRoll(buildRoll('{enganar}[Enganar] - {stress_teste}[Stress]', { ...t, stress_teste: '' })))
      .toBe('/roll 0[Enganar]');
    expect(cleanRoll('/roll 1d20+4[A] - 0[Stress] + 0[B]')).toBe('/roll 1d20+4[A]');
  });

  it('gera dano de arma', () => {
    const t = tokens(parseStatus(STATUS_EXEMPLO));
    expect(weaponRoll('Corpo a corpo + 2d20 + 20', t, true, 'Espada longa'))
      .toBe('/roll 1d30+8[Base] + 2d20+20[Espada longa] + 30[Stress]');
    expect(weaponRoll('Longo alcance + d12 (perfurante)', t, false, 'Arco'))
      .toBe('/roll 1d10+2[Base] + 1d12[Arco]');
  });
});

describe('FichaParser — mochila', () => {
  it('exporta idêntico quando nada muda', () => {
    expect(serializeMochila(parseMochila(MOCHILA_EXEMPLO))).toBe(MOCHILA_EXEMPLO);
    expect(serializeMochila(parseMochila(mochilaTemplate()))).toBe(mochilaTemplate());
  });

  it('lê itens, pesos e reconstrói ao editar', () => {
    const m = parseMochila(MOCHILA_EXEMPLO);
    expect(m.sections.map(s => s.title)).toEqual(['Mochila', 'Equipados']);
    const [espada, pocao] = m.sections[0].items;
    expect(espada.attrs.map(a => a.key)).toEqual(['Dano', 'Peso']);
    expect(itemWeight(pocao)).toEqual({ qty: 2, unit: 0.5, total: 1 });
    expect(pocao.notes).toEqual(['   cura 50 de HP']);
    espada.attrs[1].value = '4 kg';
    m.dirty = true;
    const out = serializeMochila(m);
    expect(out).toContain('        |_>> Peso = 4 kg');
    expect(serializeMochila(parseMochila(out))).toBe(out);
  });

  it('detecta tipo e decodifica 1252', () => {
    expect(detectType(MOCHILA_EXEMPLO)).toBe('mochila');
    expect(detectType(STATUS_EXEMPLO)).toBe('status');
    expect(decode(new Uint8Array([0x50, 0x6f, 0xe7, 0xe3, 0x6f]))).toBe('Poção');
    expect(decode(new TextEncoder().encode('Poção'))).toBe('Poção');
  });
});

import { formulaComPassivas, rolagens } from './rolagens';
import { DEFAULT_CONFIG } from './models';

describe('Passivas de dano', () => {
  it('aplicam % nas armas e nas rolagens com Ataque', () => {
    const cfg = { ...DEFAULT_CONFIG, pctDanoCC: 5 };
    const r = rolagens(parseStatus(STATUS_EXEMPLO), parseMochila(MOCHILA_EXEMPLO), cfg);
    expect(r.find(x => x.nome === 'Espada longa')!.cmd)
      .toBe('/roll floor((1d30+8[Base] + 2d20+20[Espada longa] + 30[Stress]) * 1.05)');
    expect(r.find(x => x.nome === 'Arco curto')!.cmd).toBe('/roll 1d10+2[Base] + 1d12[Arco curto] + 30[Stress]');
    expect(r.find(x => x.nome === 'Dano CC')!.cmd).toBe('/roll floor((1d30+8[Ataque CC] + 30[Stress]) * 1.05)');
    expect(r.find(x => x.nome === 'Precisão CC')!.cmd).toBe('/roll 1d20+4[Precisão CC] - 3[Stress]');
    // fórmula escrita à mão também recebe a passiva
    expect(formulaComPassivas({ nome: 'x', formula: '{atk_cc}[A]' }, cfg)).toBe('floor(({atk_cc}[A]) * 1.05)');
  });
});
