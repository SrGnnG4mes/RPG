import { Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MochilaItem, MochilaSection, itemWeight, norm, weaponRoll } from '../core/ficha-parser.service';
import { FichasStore } from '../core/fichas.store';
import { carga, tokensComConfig } from '../core/rolagens';
import { UiService } from '../core/ui.service';

const fmt = (n: number) => (Math.round(n * 100) / 100).toLocaleString('pt-BR');

@Component({
  selector: 'app-mochila',
  imports: [FormsModule],
  templateUrl: './mochila.html',
})
export class MochilaComponent {
  readonly store = inject(FichasStore);
  readonly ui = inject(UiService);
  readonly fmt = fmt;

  readonly view = computed(() => {
    this.store.rev();
    const m = this.store.mochila, s = this.store.sheet;
    if (!m || !s) return null;
    const c = carga(s, m);
    const pct = c.limite > 0 ? Math.min(100, (c.total / c.limite) * 100) : 0;
    return { sections: m.sections, ...c, pct };
  });

  peso(it: MochilaItem): string {
    const w = itemWeight(it);
    if (!w.unit) return '';
    return w.qty > 1 ? `${w.qty} × ${fmt(w.unit)} = ${fmt(w.total)} kg` : `${fmt(w.total)} kg`;
  }

  dano(it: MochilaItem): string | null {
    const a = it.attrs.find(x => norm(x.key) === 'dano');
    return a && a.value.trim() ? a.value : null;
  }

  copiarDano(it: MochilaItem): void {
    const s = this.store.sheet;
    const d = this.dano(it);
    if (!s || !d) return;
    const cfg = this.store.config();
    this.ui.copy(weaponRoll(d, tokensComConfig(s, cfg), cfg.stressDano, it.name));
  }

  private changed(): void {
    if (this.store.mochila) this.store.mochila.dirty = true;
    this.store.touch();
  }

  setNome(it: MochilaItem, v: string): void {
    it.name = v.replace(/^\s+/, '') || 'Item';
    this.changed();
  }
  setAttr(it: MochilaItem, i: number, campo: 'key' | 'value', v: string): void {
    it.attrs[i][campo] = campo === 'key' ? v.replace(/=/g, '').trim() || 'Atributo' : v;
    this.changed();
  }
  addAttr(it: MochilaItem): void {
    const ultimo = it.attrs[it.attrs.length - 1];
    if (ultimo) ultimo.pre = ultimo.pre.replace('|_>>', '|>>');
    const ind = ultimo?.pre.match(/^\s*/)?.[0] ?? '        ';
    it.attrs.push({ pre: ind + '|_>> ', key: 'Atributo', value: '' });
    this.changed();
  }
  removeAttr(it: MochilaItem, i: number): void {
    it.attrs.splice(i, 1);
    const ultimo = it.attrs[it.attrs.length - 1];
    if (ultimo && !ultimo.pre.includes('|_>>')) ultimo.pre = ultimo.pre.replace('|>>', '|_>>');
    this.changed();
  }
  notas(it: MochilaItem): string {
    return it.notes.map(n => n.replace(/^\s+/, '')).join('\n');
  }
  setNotas(it: MochilaItem, v: string): void {
    it.notes = v.split('\n').filter(l => l.trim()).map(l => '   ' + l.trim());
    this.changed();
  }
  addItem(s: MochilaSection): void {
    s.items.push({ name: 'Novo item', attrs: [{ pre: '        |_>> ', key: 'Peso', value: '0 kg' }], notes: [] });
    this.changed();
  }
  removeItem(s: MochilaSection, i: number): void {
    if (!confirm(`Remover "${s.items[i].name}"?`)) return;
    s.items.splice(i, 1);
    this.changed();
  }
  addSecao(): void {
    const titulo = prompt('Nome da seção:')?.trim();
    if (!titulo || !this.store.mochila) return;
    this.store.mochila.sections.push({ header: `=== ( ${titulo} ) ===`, title: titulo, level: 2, items: [] });
    this.changed();
  }
}
