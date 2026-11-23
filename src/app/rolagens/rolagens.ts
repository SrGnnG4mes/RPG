import { Component, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TOKEN_NAMES, Tokens, buildRoll, cleanRoll } from '../core/ficha-parser.service';
import { FichasStore } from '../core/fichas.store';
import {
  ATRIBUTOS, Arredondar, ModoStress, Montagem, Termo, explicarPercentual, lerFormula, montagemVazia,
  montarFormula, normalizarDado,
} from '../core/formula-builder';
import { AppConfig, DEFAULT_FORMULAS, Formula } from '../core/models';
import { carga, formulaComPassivas, pctPassivas, rolagens, tokensComConfig } from '../core/rolagens';
import { UiService } from '../core/ui.service';

/** Item em edição: `manual` = escrita à mão; senão é montada pelo seletor em `m`. */
interface Rascunho { nome: string; formula: string; orig?: string; manual: boolean; m: Montagem; aberto?: boolean }

@Component({
  selector: 'app-rolagens',
  imports: [FormsModule, NgTemplateOutlet],
  templateUrl: './rolagens.html',
})
export class RolagensComponent {
  readonly store = inject(FichasStore);
  readonly ui = inject(UiService);

  readonly editando = signal(false);
  rascunho: Rascunho[] = [];

  readonly atributos = ATRIBUTOS;
  readonly modosStress: { v: ModoStress; nome: string }[] = [
    { v: 'nenhum', nome: 'Sem Stress' }, { v: 'teste', nome: '− nos testes' }, { v: 'dano', nome: '+ no dano' },
  ];
  readonly arredondamentos: { v: Arredondar; nome: string }[] = [
    { v: 'floor', nome: 'para baixo' }, { v: 'round', nome: 'mais próximo' }, { v: 'ceil', nome: 'para cima' },
  ];

  readonly lista = computed(() => {
    this.store.rev();
    const s = this.store.sheet;
    return s ? rolagens(s, this.store.mochila, this.store.config()) : [];
  });

  // ----- favoritas -----
  readonly favoritas = computed(() => new Set(this.store.config().favoritas ?? []));
  readonly fav = computed(() => this.lista().filter(r => this.favoritas().has(r.chave)));
  readonly outras = computed(() => this.lista().filter(r => !this.favoritas().has(r.chave)));

  toggleFav(chave: string): void {
    const atual = this.store.config().favoritas ?? [];
    const favoritas = atual.includes(chave) ? atual.filter(c => c !== chave) : [...atual, chave];
    this.store.setConfig({ ...this.store.config(), favoritas });
  }

  // ----- valores atuais da ficha -----
  private readonly valores = computed(() => {
    this.store.rev();
    const s = this.store.sheet;
    return s ? tokensComConfig(s, this.store.config()) : null;
  });
  readonly tokens = computed(() => {
    const t = this.valores();
    return t ? TOKEN_NAMES.map(k => ({ k, v: t[k] || '0' })) : [];
  });
  valor(token: string): string { return this.valores()?.[token as keyof Tokens] || '0'; }

  readonly carga = computed(() => {
    this.store.rev();
    const s = this.store.sheet;
    return s ? carga(s, this.store.mochila) : null;
  });

  copiar(cmd: string): void { this.ui.copy(cmd); }

  toggleStress(campo: 'stressTeste' | 'stressDano', v: boolean): void {
    this.store.setConfig({ ...this.store.config(), [campo]: v });
  }

  setPassiva(campo: 'pctDanoCC' | 'pctDanoLA', v: string): void {
    const n = Number(String(v).replace(',', '.'));
    this.store.setConfig({ ...this.store.config(), [campo]: Number.isFinite(n) ? n : 0 });
  }

  // ----- edição -----
  private paraRascunho(f: Formula, orig?: string): Rascunho {
    const m = f.montagem ?? lerFormula(f.formula);
    return { nome: f.nome, formula: f.formula, orig, manual: !m, m: m ? structuredClone(m) : montagemVazia() };
  }

  editar(): void {
    this.rascunho = this.store.config().formulas.map(f => this.paraRascunho(f, f.nome));
    this.editando.set(true);
  }
  adicionar(): void {
    this.rascunho.forEach(f => (f.aberto = false));
    this.rascunho.push({ nome: 'Nova rolagem', formula: '', manual: false, m: montagemVazia(), aberto: true });
  }
  remover(i: number): void {
    if (confirm(`Remover a rolagem "${this.rascunho[i].nome}"?`)) this.rascunho.splice(i, 1);
  }
  /** Abre uma rolagem para editar (fecha as outras, para a lista ficar curta). */
  alternar(f: Rascunho): void {
    const abrir = !f.aberto;
    this.rascunho.forEach(x => (x.aberto = false));
    f.aberto = abrir;
  }
  mover(i: number, d: number): void {
    const j = i + d;
    if (j < 0 || j >= this.rascunho.length) return;
    [this.rascunho[i], this.rascunho[j]] = [this.rascunho[j], this.rascunho[i]];
  }
  padrao(): void {
    if (confirm('Restaurar as fórmulas padrão? As suas fórmulas personalizadas serão substituídas.')) {
      this.rascunho = DEFAULT_FORMULAS.map(f => this.paraRascunho(f));
    }
  }
  salvar(): void {
    const cfg = this.store.config();
    const validas = this.rascunho.filter(f => f.formula.trim());
    // renomeou uma fórmula favorita → o favorito acompanha o novo nome
    const renomes = new Map(validas.filter(f => f.orig && f.orig !== f.nome).map(f => ['f:' + f.orig, 'f:' + f.nome]));
    const favoritas = (cfg.favoritas ?? []).map(c => renomes.get(c) ?? c);
    const formulas: Formula[] = validas.map(f => (f.manual
      ? { nome: f.nome, formula: f.formula }
      : { nome: f.nome, formula: f.formula, montagem: f.m }));
    this.store.setConfig({ ...cfg, favoritas, formulas });
    this.editando.set(false);
  }
  cancelar(): void { this.editando.set(false); }

  // ----- montador -----
  private remontar(f: Rascunho): void { f.formula = montarFormula(f.m); }

  temAtributo(f: Rascunho, token: string): boolean {
    return f.m.termos.some(t => t.tipo === 'atributo' && t.valor === token);
  }
  toggleAtributo(f: Rascunho, token: string): void {
    const i = f.m.termos.findIndex(t => t.tipo === 'atributo' && t.valor === token);
    if (i >= 0) f.m.termos.splice(i, 1);
    else f.m.termos.push({ sinal: '+', tipo: 'atributo', valor: token });
    this.remontar(f);
  }
  /** "5" vira número fixo; "2d6"/"d6" vira dado. */
  addExtra(f: Rascunho, input: HTMLInputElement): void {
    const v = input.value.trim();
    const dado = normalizarDado(v);
    if (dado) f.m.termos.push({ sinal: '+', tipo: 'dado', valor: dado });
    else if (/^\d+$/.test(v)) f.m.termos.push({ sinal: '+', tipo: 'numero', valor: v });
    else { this.ui.toast('Digite um número (ex.: 5) ou um dado (ex.: 2d6)'); return; }
    input.value = '';
    this.remontar(f);
  }
  trocarSinal(f: Rascunho, t: Termo): void { t.sinal = t.sinal === '+' ? '-' : '+'; this.remontar(f); }
  removerTermo(f: Rascunho, i: number): void { f.m.termos.splice(i, 1); this.remontar(f); }
  setRotulo(f: Rascunho, t: Termo, v: string): void {
    if (v.trim()) t.rotulo = v.replace(/[[\]]/g, ''); else delete t.rotulo;
    this.remontar(f);
  }
  setStress(f: Rascunho, modo: ModoStress): void { f.m.stress = modo; this.remontar(f); }
  setPercentual(f: Rascunho, v: number | null): void {
    f.m.percentual = Number.isFinite(Number(v)) ? Number(v) : 0;
    this.remontar(f);
  }
  setArredondar(f: Rascunho, v: Arredondar): void { f.m.arredondar = v; this.remontar(f); }

  nomeTermo(t: Termo): string {
    if (t.tipo === 'atributo') return ATRIBUTOS.find(a => a.token === t.valor)?.nome ?? t.valor;
    return t.tipo === 'dado' ? `Dado ${t.valor}` : `Fixo ${t.valor}`;
  }
  valorTermo(t: Termo): string { return t.tipo === 'atributo' ? this.valor(t.valor) : ''; }

  alternarManual(f: Rascunho): void {
    if (!f.manual) { f.manual = true; return; }
    const m = lerFormula(f.formula);
    if (m) { f.m = m; f.manual = false; return; }
    if (confirm('Esta fórmula foi escrita à mão num formato que o seletor não representa. Começar do zero no seletor?')) {
      f.m = montagemVazia();
      f.formula = '';
      f.manual = false;
    }
  }

  /** Comando final (com valores da ficha e passivas), para conferir antes de salvar. */
  previa(f: Rascunho): string {
    const t = this.valores();
    if (!t || !f.formula.trim()) return '';
    const formula: Formula = f.manual ? { nome: f.nome, formula: f.formula } : { nome: f.nome, formula: f.formula, montagem: f.m };
    return cleanRoll(buildRoll(formulaComPassivas(formula, this.store.config()), t));
  }
  explicacao(f: Rascunho): string {
    const cfg: AppConfig = this.store.config();
    const passiva = pctPassivas(f.formula, cfg);
    const total = (f.manual ? 0 : f.m.percentual || 0) + passiva;
    const partes = [explicarPercentual(total, f.manual ? 'floor' : f.m.arredondar)];
    if (passiva) partes.push(`Inclui ${passiva > 0 ? '+' : ''}${passiva}% das passivas de dano.`);
    return partes.filter(Boolean).join(' ');
  }
}
