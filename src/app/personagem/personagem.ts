import { Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Field, GOSTA_MAX, bumpMain, findField, joinGosta, mainNumber, norm, splitGosta, stressValue } from '../core/ficha-parser.service';
import { FichasStore } from '../core/fichas.store';
import { RolagensComponent } from '../rolagens/rolagens';

interface Grupo { cat: string; fields: Field[] }

const sign = (n: number) => (n < 0 ? '-' : '+') + Math.abs(n);

@Component({
  selector: 'app-personagem',
  imports: [FormsModule, RolagensComponent],
  templateUrl: './personagem.html',
})
export class PersonagemComponent {
  readonly store = inject(FichasStore);

  readonly view = computed(() => {
    this.store.rev();
    const s = this.store.sheet;
    if (!s) return null;
    const nivel = s.fields.find(f => f.kind === 'nivel') ?? null;
    const ident = s.fields.filter(f => f.cat === 'Identidade' && f.kind !== 'nivel');
    const vitais = s.fields.filter(f => f.kind === 'vital');
    const grupos: Grupo[] = [];
    s.fields.forEach(f => {
      if (f.cat === 'Identidade' || f.kind === 'vital') return;
      let g = grupos.find(x => x.cat === f.cat);
      if (!g) { g = { cat: f.cat, fields: [] }; grupos.push(g); }
      g.fields.push(f);
    });
    const reac = findField(s, 'precis', 'velocidade de rea');
    const refl = findField(s, 'destreza', 'reflexo');
    const pc = findField(s, 'precis', 'corpo a corpo'), pl = findField(s, 'precis', 'longo alcan');
    const ec = findField(s, 'destreza', 'esquiva de ataque corpo'), el = findField(s, 'destreza', 'esquiva de longo');
    const calc: Record<string, string> = {};
    if (reac && pc?.kind === 'dice' && pl?.kind === 'dice') calc[reac.id] = '+' + Math.floor((pc.die! + pl.die!) / 10);
    if (refl && ec?.kind === 'dice' && el?.kind === 'dice') calc[refl.id] = '+' + Math.floor((ec.die! + el.die!) / 10);
    const gosta = s.fields.find(f => f.id === 'gosta') ?? null;
    return { nivel, ident, gosta, vitais, grupos, calc, sections: s.sections, stress: stressValue(s), stressT: Math.floor(stressValue(s) / 10) };
  });

  // ----- Gosta de: um campo por item, gravado como "a / b / c" -----
  readonly gostaMax = GOSTA_MAX;
  private slots = new WeakMap<Field, { orig: string; itens: string[] }>();

  gostaSlots(f: Field): string[] {
    let s = this.slots.get(f);
    if (!s) {
      const itens = splitGosta(f.value);
      while (itens.length < GOSTA_MAX) itens.push('');
      s = { orig: f.value, itens };
      this.slots.set(f, s);
    }
    return s.itens;
  }

  setGosta(f: Field, i: number, v: string): void {
    const s = this.slots.get(f);
    if (!s) return;
    s.itens[i] = v;
    this.setText(f, joinGosta(s.itens, s.orig));
  }

  total(f: Field): string {
    const t = (f.b1 ?? 0) + (f.b2 ?? 0);
    return `d${f.die}${t ? sign(t) : ''}`;
  }

  isStress(f: Field): boolean { return norm(f.key) === 'stress'; }

  edit(f: Field): void {
    f.dirty = true;
    this.store.touch();
  }

  setText(f: Field, v: string): void { f.value = v; this.edit(f); }

  setVital(f: Field, v: number | null): void {
    if (v === null || Number.isNaN(Number(v))) return;
    this.setText(f, String(Math.trunc(Number(v))));
  }

  // campos numéricos: valor vazio/incompleto (ex.: só "-") é ignorado até virar número
  setNum(f: Field, prop: 'die' | 'b1' | 'b2', v: number | null): void {
    if (v === null || Number.isNaN(Number(v))) return;
    const n = Math.trunc(Number(v));
    if (prop === 'die') { this.changeDie(f, n); return; }
    f[prop] = n;
    this.edit(f);
  }

  setNivel(prop: 'nivel' | 'pontos' | 'pontosNivel', v: number | null): void {
    const f = this.view()?.nivel;
    if (!f || v === null || Number.isNaN(Number(v))) return;
    f[prop] = Math.trunc(Number(v));
    this.edit(f);
  }

  // ----- atributos marcados com "*" na ficha (ex.: "4d30", "1d25", "+10") -----
  // 1 ponto = +1 no número principal (lados do dado ou valor do bônus).
  private ultimoNum = new WeakMap<Field, number>();

  private gastar(delta: number): void {
    const nv = this.view()?.nivel;
    if (delta && nv && nv.pontos != null) { nv.pontos -= delta; nv.dirty = true; }
  }

  /** Digitando: desconta a diferença do número principal (ignora estados incompletos, ex.: "+"). */
  setAttr(f: Field, v: string): void {
    const antes = this.ultimoNum.has(f) ? this.ultimoNum.get(f)! : mainNumber(f.value);
    const depois = mainNumber(v);
    if (depois !== null) {
      if (antes !== null) this.gastar(depois - antes);
      this.ultimoNum.set(f, depois);
    }
    this.setText(f, v);
  }

  stepMain(f: Field, d: 1 | -1): void {
    const novo = bumpMain(f.value, d);
    if (novo === null || novo === f.value) return;
    this.setAttr(f, novo);
  }

  /** − / +: muda o dado em 1 e gasta/devolve 1 ponto livre. */
  step(f: Field, d: 1 | -1): void {
    this.changeDie(f, (f.die ?? 0) + d);
  }

  /** Muda o dado (botões ou digitando) e gasta/devolve 1 ponto livre por número de diferença. */
  private changeDie(f: Field, novo: number): void {
    novo = Math.max(0, novo);
    const delta = novo - (f.die ?? 0);
    if (!delta) return;
    f.die = novo;
    f.dirty = true;
    const nv = this.view()?.nivel;
    if (nv && nv.pontos != null) { nv.pontos -= delta; nv.dirty = true; }
    this.store.touch();
  }

  toggleAuto(f: Field): void {
    f.auto = !f.auto;
    if (f.auto) { f.b1 = Math.floor((f.die ?? 0) / 5); this.edit(f); }
    else this.store.rev.update(v => v + 1);
  }

  setSection(i: number, text: string): void {
    const s = this.store.sheet?.sections[i];
    if (!s) return;
    s.text = text;
    this.store.touch();
  }

  rows(text: string): number {
    return Math.min(24, Math.max(3, text.split('\n').length + 1));
  }
}
