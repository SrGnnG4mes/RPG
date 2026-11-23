import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Unsubscribe } from 'firebase/firestore';
import {
  Mochila, StatusSheet, applyAuto, decode, detectType, norm, parseMochila, parseStatus,
  serializeMochila, serializeStatus,
} from './ficha-parser.service';
import { FirebaseService, RemoteFicha } from './firebase.service';
import { AppConfig, DEFAULT_CONFIG, FichaDoc } from './models';
import { mochilaTemplate, statusTemplate } from './templates';

const LS_FICHAS = 'rpg.fichas';
const LS_CONFIG = 'rpg.config';
const LS_ATUAL = 'rpg.atual';
const SAVE_DELAY = 800;

export type SyncState = 'local' | 'carregando' | 'salvando' | 'salvo' | 'pendente' | 'erro';

function lsGet<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function lsSet(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* sem armazenamento */ }
}
function lsDel(key: string): void {
  try { localStorage.removeItem(key); } catch { /* idem */ }
}
/** Junta a config salva com os padrões; fórmulas salvas pelo usuário nunca são alteradas. */
const comPadrao = (p: Partial<AppConfig>): AppConfig => ({ ...DEFAULT_CONFIG, ...p });
const byNome = (a: FichaDoc, b: FichaDoc) => a.nome.localeCompare(b.nome, 'pt-BR');
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

/**
 * Estado das fichas: lista, ficha aberta (já interpretada) e persistência
 * (Firestore quando logado, localStorage quando não), com salvamento em debounce.
 */
@Injectable({ providedIn: 'root' })
export class FichasStore {
  private fb = inject(FirebaseService);

  readonly fichas = signal<FichaDoc[]>([]);
  readonly currentId = signal<string | null>(null);
  readonly config = signal<AppConfig>(DEFAULT_CONFIG);
  readonly sync = signal<SyncState>('local');
  /** incrementa a cada edição: use em computed() que leem `sheet`/`mochila` */
  readonly rev = signal(0);
  readonly current = computed(() => this.fichas().find(f => f.id === this.currentId()) ?? null);

  sheet: StatusSheet | null = null;
  mochila: Mochila | null = null;

  private uid: string | null = null;
  private unsub: Unsubscribe | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastSynced = { status: '', mochila: '' };
  private firstSnapshot = true;

  constructor() {
    if (this.fb.enabled) {
      this.sync.set('carregando');
      effect(() => {
        const loading = this.fb.authLoading();
        const uid = this.fb.user()?.uid ?? null;
        if (!loading) untracked(() => this.onUser(uid));
      });
    } else {
      this.loadLocal();
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => this.flush());
      document.addEventListener('visibilitychange', () => { if (document.hidden) this.flush(); });
    }
  }

  get loggedIn(): boolean { return !!this.uid; }

  // ---------- modo local / nuvem ----------
  private loadLocal(): void {
    this.uid = null;
    this.sync.set('local');
    this.fichas.set(lsGet<FichaDoc[]>(LS_FICHAS, []).sort(byNome));
    this.config.set(comPadrao(lsGet<Partial<AppConfig>>(LS_CONFIG, {})));
    const want = lsGet<string | null>(LS_ATUAL, null);
    this.openFicha(this.fichas().find(f => f.id === want)?.id ?? this.fichas()[0]?.id ?? null);
  }

  private async onUser(uid: string | null): Promise<void> {
    if (uid === this.uid && (uid || this.sync() === 'local')) return;
    this.flush();
    this.unsub?.();
    this.unsub = null;
    if (!uid) { this.loadLocal(); return; }

    this.uid = uid;
    this.sync.set('carregando');
    this.openFicha(null);
    this.fichas.set([]);
    try {
      // fichas criadas sem login sobem para a conta
      const local = lsGet<FichaDoc[]>(LS_FICHAS, []);
      if (local.length) {
        await this.fb.saveFichas(uid, local);
        lsDel(LS_FICHAS);
      }
      const remoteCfg = await this.fb.loadConfig(uid);
      if (remoteCfg) {
        this.config.set(comPadrao(remoteCfg));
      } else {
        const localCfg = lsGet<Partial<AppConfig> | null>(LS_CONFIG, null);
        if (localCfg) {
          this.config.set(comPadrao(localCfg));
          await this.fb.saveConfig(uid, this.config());
        } else {
          this.config.set(DEFAULT_CONFIG);
        }
      }
    } catch (e) {
      console.error(e);
      this.sync.set('erro');
    }
    if (this.uid !== uid) return; // deslogou no meio
    this.firstSnapshot = true;
    this.unsub = this.fb.watchFichas(uid, list => this.onRemote(list), e => {
      console.error(e);
      this.sync.set('erro');
    });
  }

  private onRemote(list: RemoteFicha[]): void {
    const curId = this.currentId();
    const editing = !!this.timer;
    const mine = this.current();
    const merged: FichaDoc[] = list.map(r =>
      r.id === curId && editing && mine ? mine : { id: r.id, nome: r.nome, status: r.status, mochila: r.mochila });
    this.fichas.set(merged.sort(byNome));
    if (!editing) this.sync.set(list.some(r => r.pending) ? 'pendente' : 'salvo');

    if (this.firstSnapshot) {
      this.firstSnapshot = false;
      const want = lsGet<string | null>(LS_ATUAL, null);
      this.openFicha(merged.find(f => f.id === want)?.id ?? merged[0]?.id ?? null);
      return;
    }
    if (curId && !merged.some(f => f.id === curId)) {
      this.openFicha(merged[0]?.id ?? null);
      return;
    }
    // alterada em outro dispositivo → recarrega (se não há edição local em andamento)
    const r = list.find(x => x.id === curId);
    if (r && !editing && !r.pending && (r.status !== this.lastSynced.status || r.mochila !== this.lastSynced.mochila)) {
      this.openFicha(r.id);
    }
  }

  // ---------- ficha aberta ----------
  select(id: string | null): void {
    if (id === this.currentId()) return;
    this.flush();
    this.openFicha(id);
  }

  private openFicha(id: string | null): void {
    const f = this.fichas().find(x => x.id === id) ?? null;
    this.currentId.set(f?.id ?? null);
    this.sheet = f ? parseStatus(f.status) : null;
    this.mochila = f ? parseMochila(f.mochila) : null;
    this.lastSynced = { status: f?.status ?? '', mochila: f?.mochila ?? '' };
    if (f) lsSet(LS_ATUAL, f.id);
    this.rev.update(v => v + 1);
  }

  /** Chame após qualquer edição em `sheet` ou `mochila`. */
  touch(): void {
    if (this.sheet) applyAuto(this.sheet);
    this.rev.update(v => v + 1);
    if (this.timer) clearTimeout(this.timer);
    if (this.uid) this.sync.set('salvando');
    this.timer = setTimeout(() => { this.timer = null; this.persistCurrent(); }, SAVE_DELAY);
  }

  flush(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
    this.persistCurrent();
  }

  private persistCurrent(): void {
    const cur = this.current();
    if (!cur || !this.sheet || !this.mochila) return;
    const status = serializeStatus(this.sheet);
    const mochila = serializeMochila(this.mochila);
    const nome = this.sheet.fields.find(f => f.id === 'id_nome')?.value.trim() || cur.nome;
    const updated: FichaDoc = { ...cur, nome, status, mochila };
    this.lastSynced = { status, mochila };
    this.fichas.update(list => list.map(f => (f.id === cur.id ? updated : f)).sort(byNome));
    this.persist([updated]);
  }

  private persist(changed: FichaDoc[]): void {
    if (this.uid) {
      this.sync.set('salvando');
      const p = changed.length === 1 ? this.fb.saveFicha(this.uid, changed[0]) : this.fb.saveFichas(this.uid, changed);
      p.then(() => this.sync.set('salvo')).catch(e => { console.error(e); this.sync.set('erro'); });
    } else {
      lsSet(LS_FICHAS, this.fichas());
    }
  }

  // ---------- ações ----------
  novaFicha(nome: string): void {
    this.flush();
    const f: FichaDoc = { id: newId(), nome, status: statusTemplate(nome), mochila: mochilaTemplate() };
    this.fichas.update(l => [...l, f].sort(byNome));
    this.persist([f]);
    this.openFicha(f.id);
  }

  async apagar(id: string): Promise<void> {
    if (this.currentId() === id && this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.fichas.update(l => l.filter(f => f.id !== id));
    if (this.uid) {
      this.fb.deleteFicha(this.uid, id).catch(e => { console.error(e); this.sync.set('erro'); });
    } else {
      lsSet(LS_FICHAS, this.fichas());
    }
    if (this.currentId() === id) this.openFicha(this.fichas()[0]?.id ?? null);
  }

  /** Importa vários Status_X.txt / Mochila_X.txt; agrupa por nome do arquivo. */
  async importar(files: File[]): Promise<string> {
    this.flush();
    const grupos = new Map<string, { nome: string; status?: string; mochila?: string }>();
    const ignorados: string[] = [];
    for (const file of files) {
      const text = decode(new Uint8Array(await file.arrayBuffer()));
      const tipo = detectType(text) ?? (/mochila/i.test(file.name) ? 'mochila' : /status/i.test(file.name) ? 'status' : null);
      if (!tipo) { ignorados.push(file.name); continue; }
      let nome = file.name.replace(/\.txt$/i, '').replace(/^(status|mochila)[\s_-]*/i, '').trim();
      if (tipo === 'status') {
        const sheet = parseStatus(text);
        nome = nome || sheet.fields.find(f => f.id === 'id_nome')?.value.trim() || 'Sem nome';
      }
      nome = nome || 'Sem nome';
      const key = norm(nome);
      const g = grupos.get(key) ?? { nome };
      if (tipo === 'status') g.status = serializeStatus(parseStatus(text));
      else g.mochila = serializeMochila(parseMochila(text));
      grupos.set(key, g);
    }

    const changed: FichaDoc[] = [];
    let list = [...this.fichas()];
    for (const [key, g] of grupos) {
      const idx = list.findIndex(f => norm(f.nome) === key);
      const base: FichaDoc = idx >= 0
        ? list[idx]
        : { id: newId(), nome: g.nome, status: statusTemplate(g.nome), mochila: mochilaTemplate() };
      const f: FichaDoc = { ...base, status: g.status ?? base.status, mochila: g.mochila ?? base.mochila };
      if (idx >= 0) list[idx] = f; else list.push(f);
      changed.push(f);
    }
    list = list.sort(byNome);
    this.fichas.set(list);
    if (changed.length) {
      this.persist(changed);
      this.openFicha(changed[changed.length - 1].id);
    }
    const partes = [`${changed.length} ficha(s) importada(s)`];
    if (ignorados.length) partes.push(`ignorado(s): ${ignorados.join(', ')}`);
    return partes.join(' · ');
  }

  exportar(tipo: 'status' | 'mochila'): { nome: string; texto: string } | null {
    this.flush();
    const cur = this.current();
    if (!cur || !this.sheet || !this.mochila) return null;
    const texto = tipo === 'status' ? serializeStatus(this.sheet) : serializeMochila(this.mochila);
    const base = cur.nome.replace(/[\\/:*?"<>|]+/g, '').trim() || 'Ficha';
    return { nome: `${tipo === 'status' ? 'Status' : 'Mochila'}_${base}.txt`, texto };
  }

  setConfig(cfg: AppConfig): void {
    this.config.set(cfg);
    if (this.uid) {
      this.fb.saveConfig(this.uid, cfg).catch(e => { console.error(e); this.sync.set('erro'); });
    } else {
      lsSet(LS_CONFIG, cfg);
    }
  }
}
