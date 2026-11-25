import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Unsubscribe } from 'firebase/firestore';
import { Mochila, StatusSheet, decode, detectType, norm, parseMochila, serializeMochila } from './ficha-parser.service';
import { FirebaseService, RemoteFicha } from './firebase.service';
import { AppConfig, DEFAULT_CONFIG, FichaDoc } from './models';
import { Sistema, SistemaId, sistemaPorId } from './sistemas';
import { mochilaTemplate } from './templates';

const LS_SISTEMA = 'rpg.sistema';
const SAVE_DELAY = 800;

/** Chaves do localStorage por RPG (as do RPG Dark são as originais). */
const ls = (sistema: SistemaId) => {
  const p = sistema === 'dark' ? 'rpg.' : `rpg.${sistema}.`;
  return { fichas: p + 'fichas', config: p + 'config', atual: p + 'atual' };
};

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
const byNome = (a: FichaDoc, b: FichaDoc) => a.nome.localeCompare(b.nome, 'pt-BR');
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

/**
 * Estado das fichas do RPG escolhido: lista, ficha aberta (já interpretada) e persistência
 * (Firestore quando logado, localStorage quando não), com salvamento em debounce.
 * Cada RPG tem fichas e configurações separadas.
 */
@Injectable({ providedIn: 'root' })
export class FichasStore {
  private fb = inject(FirebaseService);

  readonly sistema = signal<Sistema | null>(sistemaPorId(lsGet<string | null>(LS_SISTEMA, null)));
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
  private iniciado = false;
  private unsub: Unsubscribe | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastSynced = { status: '', mochila: '' };
  private firstSnapshot = true;
  /** evita que um carregamento antigo (troca rápida de RPG/conta) sobrescreva o atual */
  private geracao = 0;

  constructor() {
    if (this.fb.enabled) {
      this.sync.set('carregando');
      effect(() => {
        const loading = this.fb.authLoading();
        const uid = this.fb.user()?.uid ?? null;
        if (loading) return;
        untracked(() => {
          if (this.iniciado && uid === this.uid) return;
          this.iniciado = true;
          this.flush();
          this.uid = uid;
          this.carregar();
        });
      });
    } else {
      this.iniciado = true;
      this.carregar();
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => this.flush());
      document.addEventListener('visibilitychange', () => { if (document.hidden) this.flush(); });
    }
  }

  get loggedIn(): boolean { return !!this.uid; }

  private comPadrao(p: Partial<AppConfig>): AppConfig {
    return { ...DEFAULT_CONFIG, formulas: this.sistema()?.formulasPadrao ?? [], ...p };
  }

  // ---------- escolha do RPG ----------
  escolherSistema(id: SistemaId | null): void {
    if (id === (this.sistema()?.id ?? null)) return;
    this.flush();
    this.sistema.set(sistemaPorId(id));
    if (id) lsSet(LS_SISTEMA, id); else lsDel(LS_SISTEMA);
    if (this.iniciado) this.carregar();
  }

  // ---------- carregar (local ou nuvem) ----------
  private carregar(): void {
    const g = ++this.geracao;
    this.unsub?.();
    this.unsub = null;
    this.openFicha(null);
    this.fichas.set([]);
    const s = this.sistema();
    if (!s) { this.sync.set(this.uid ? 'salvo' : 'local'); return; }
    if (this.uid) this.carregarNuvem(this.uid, s, g);
    else this.carregarLocal(s);
  }

  private carregarLocal(s: Sistema): void {
    const k = ls(s.id);
    this.sync.set('local');
    this.fichas.set(lsGet<FichaDoc[]>(k.fichas, []).sort(byNome));
    this.config.set(this.comPadrao(lsGet<Partial<AppConfig>>(k.config, {})));
    const want = lsGet<string | null>(k.atual, null);
    this.openFicha(this.fichas().find(f => f.id === want)?.id ?? this.fichas()[0]?.id ?? null);
  }

  private async carregarNuvem(uid: string, s: Sistema, g: number): Promise<void> {
    const k = ls(s.id);
    const base = FirebaseService.base(uid, s.id);
    this.sync.set('carregando');
    try {
      // fichas criadas sem login (neste RPG) sobem para a conta
      const local = lsGet<FichaDoc[]>(k.fichas, []);
      if (local.length) {
        await this.fb.saveFichas(base, local);
        lsDel(k.fichas);
      }
      const remoteCfg = await this.fb.loadConfig(base);
      if (g !== this.geracao) return;
      if (remoteCfg) {
        this.config.set(this.comPadrao(remoteCfg));
      } else {
        const localCfg = lsGet<Partial<AppConfig> | null>(k.config, null);
        this.config.set(this.comPadrao(localCfg ?? {}));
        if (localCfg) await this.fb.saveConfig(base, this.config());
      }
    } catch (e) {
      console.error(e);
      this.sync.set('erro');
    }
    if (g !== this.geracao) return; // trocou de RPG ou de conta no meio
    this.firstSnapshot = true;
    this.unsub = this.fb.watchFichas(base, list => this.onRemote(list), e => {
      console.error(e);
      this.sync.set('erro');
    });
  }

  private onRemote(list: RemoteFicha[]): void {
    const s = this.sistema();
    if (!s) return;
    const curId = this.currentId();
    const editing = !!this.timer;
    const mine = this.current();
    const merged: FichaDoc[] = list.map(r =>
      r.id === curId && editing && mine ? mine : { id: r.id, nome: r.nome, status: r.status, mochila: r.mochila });
    this.fichas.set(merged.sort(byNome));
    if (!editing) this.sync.set(list.some(r => r.pending) ? 'pendente' : 'salvo');

    if (this.firstSnapshot) {
      this.firstSnapshot = false;
      const want = lsGet<string | null>(ls(s.id).atual, null);
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
    const s = this.sistema();
    const f = s ? this.fichas().find(x => x.id === id) ?? null : null;
    this.currentId.set(f?.id ?? null);
    this.sheet = f && s ? s.parseStatus(f.status) : null;
    this.mochila = f ? parseMochila(f.mochila) : null;
    this.lastSynced = { status: f?.status ?? '', mochila: f?.mochila ?? '' };
    if (f && s) lsSet(ls(s.id).atual, f.id);
    this.rev.update(v => v + 1);
  }

  /** Chame após qualquer edição em `sheet` ou `mochila`. */
  touch(): void {
    if (this.sheet) this.sistema()?.aplicarRegras(this.sheet);
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
    const s = this.sistema();
    const cur = this.current();
    if (!s || !cur || !this.sheet || !this.mochila) return;
    const status = s.serializeStatus(this.sheet);
    const mochila = serializeMochila(this.mochila);
    const nome = this.sheet.fields.find(f => f.id === 'id_nome')?.value.trim() || cur.nome;
    const updated: FichaDoc = { ...cur, nome, status, mochila };
    this.lastSynced = { status, mochila };
    this.fichas.update(list => list.map(f => (f.id === cur.id ? updated : f)).sort(byNome));
    this.persist([updated]);
  }

  private persist(changed: FichaDoc[]): void {
    const s = this.sistema();
    if (!s) return;
    if (this.uid) {
      const base = FirebaseService.base(this.uid, s.id);
      this.sync.set('salvando');
      const p = changed.length === 1 ? this.fb.saveFicha(base, changed[0]) : this.fb.saveFichas(base, changed);
      p.then(() => this.sync.set('salvo')).catch(e => { console.error(e); this.sync.set('erro'); });
    } else {
      lsSet(ls(s.id).fichas, this.fichas());
    }
  }

  // ---------- ações ----------
  novaFicha(nome: string): void {
    const s = this.sistema();
    if (!s) return;
    this.flush();
    const f: FichaDoc = { id: newId(), nome, status: s.statusTemplate(nome), mochila: mochilaTemplate() };
    this.fichas.update(l => [...l, f].sort(byNome));
    this.persist([f]);
    this.openFicha(f.id);
  }

  async apagar(id: string): Promise<void> {
    const s = this.sistema();
    if (!s) return;
    if (this.currentId() === id && this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.fichas.update(l => l.filter(f => f.id !== id));
    if (this.uid) {
      this.fb.deleteFicha(FirebaseService.base(this.uid, s.id), id).catch(e => { console.error(e); this.sync.set('erro'); });
    } else {
      lsSet(ls(s.id).fichas, this.fichas());
    }
    if (this.currentId() === id) this.openFicha(this.fichas()[0]?.id ?? null);
  }

  /**
   * Importa vários arquivos de Status e Mochila do RPG escolhido e agrupa pelo nome:
   * "Status_Nome.txt", "STATUS.Nome.txt", "Nome_Status.txt", "Mochila.Nome.txt"...
   */
  async importar(files: File[]): Promise<string> {
    const s = this.sistema();
    if (!s) return 'Escolha um RPG primeiro';
    this.flush();
    const grupos = new Map<string, { nome: string; status?: string; mochila?: string }>();
    const ignorados: string[] = [];
    for (const file of files) {
      const text = decode(new Uint8Array(await file.arrayBuffer()));
      const tipo = detectType(text) === 'mochila' ? 'mochila'
        : s.ehStatus(text) ? 'status'
        : /mochila/i.test(file.name) ? 'mochila' : /status/i.test(file.name) ? 'status' : null;
      if (!tipo) { ignorados.push(file.name); continue; }
      let nome = file.name.replace(/\.txt$/i, '')
        .replace(/^(status|mochila)[\s_.-]*/i, '')
        .replace(/[\s_.-]*(status|mochila)$/i, '')
        .trim();
      if (tipo === 'status' && !nome) nome = s.parseStatus(text).fields.find(f => f.id === 'id_nome')?.value.trim() ?? '';
      nome = nome || 'Sem nome';
      const key = norm(nome);
      const g = grupos.get(key) ?? { nome };
      if (tipo === 'status') g.status = s.serializeStatus(s.parseStatus(text));
      else g.mochila = serializeMochila(parseMochila(text));
      grupos.set(key, g);
    }

    const changed: FichaDoc[] = [];
    let list = [...this.fichas()];
    for (const [key, g] of grupos) {
      const idx = list.findIndex(f => norm(f.nome) === key);
      const base: FichaDoc = idx >= 0
        ? list[idx]
        : { id: newId(), nome: g.nome, status: s.statusTemplate(g.nome), mochila: mochilaTemplate() };
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
    const partes = [`${changed.length} ficha(s) importada(s) no ${s.nome}`];
    if (ignorados.length) partes.push(`ignorado(s): ${ignorados.join(', ')}`);
    return partes.join(' · ');
  }

  exportar(tipo: 'status' | 'mochila'): { nome: string; texto: string } | null {
    const s = this.sistema();
    this.flush();
    const cur = this.current();
    if (!s || !cur || !this.sheet || !this.mochila) return null;
    const texto = tipo === 'status' ? s.serializeStatus(this.sheet) : serializeMochila(this.mochila);
    const base = cur.nome.replace(/[\\/:*?"<>|]+/g, '').trim() || 'Ficha';
    return { nome: s.arquivo(tipo, base), texto };
  }

  setConfig(cfg: AppConfig): void {
    const s = this.sistema();
    if (!s) return;
    this.config.set(cfg);
    if (this.uid) {
      this.fb.saveConfig(FirebaseService.base(this.uid, s.id), cfg).catch(e => { console.error(e); this.sync.set('erro'); });
    } else {
      lsSet(ls(s.id).config, cfg);
    }
  }
}
