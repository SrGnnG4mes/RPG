import { Component, HostListener, inject, signal } from '@angular/core';
import { FichasStore } from './core/fichas.store';
import { FirebaseService } from './core/firebase.service';
import { SISTEMAS } from './core/sistemas';
import { UiService } from './core/ui.service';
import { MochilaComponent } from './mochila/mochila';
import { PersonagemComponent } from './personagem/personagem';

type Tab = 'personagem' | 'mochila';

@Component({
  selector: 'app-root',
  imports: [PersonagemComponent, MochilaComponent],
  templateUrl: './app.html',
})
export class App {
  readonly store = inject(FichasStore);
  readonly fb = inject(FirebaseService);
  readonly ui = inject(UiService);

  readonly sistemas = SISTEMAS;
  readonly tab = signal<Tab>(location.hash === '#mochila' ? 'mochila' : 'personagem');
  readonly dragging = signal(false);
  private dragDepth = 0;

  readonly syncLabel: Record<string, string> = {
    local: 'Salvo neste navegador',
    carregando: 'Carregando…',
    salvando: 'Salvando…',
    salvo: 'Salvo na nuvem',
    pendente: 'Offline — sincroniza depois',
    erro: 'Erro ao salvar',
  };

  setTab(t: Tab): void {
    this.tab.set(t);
    history.replaceState(null, '', '#' + t);
  }

  trocarRpg(): void {
    this.store.escolherSistema(null);
  }

  async onFiles(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    await this.importar(files);
  }

  private async importar(files: File[]): Promise<void> {
    const txt = files.filter(f => /\.txt$/i.test(f.name) || f.type.startsWith('text/'));
    if (!txt.length) { this.ui.toast('Selecione arquivos .txt'); return; }
    try {
      this.ui.toast(await this.store.importar(txt), 4000);
    } catch (e) {
      console.error(e);
      this.ui.toast('Falha ao importar: ' + (e as Error).message, 5000);
    }
  }

  exportar(tipo: 'status' | 'mochila'): void {
    const r = this.store.exportar(tipo);
    if (r) this.ui.download(r.nome, r.texto);
  }

  nova(): void {
    const nome = prompt('Nome do personagem:')?.trim();
    if (nome) this.store.novaFicha(nome);
  }

  apagar(): void {
    const cur = this.store.current();
    if (!cur) return;
    if (confirm(`Apagar a ficha "${cur.nome}"? Exporte antes se quiser guardar uma cópia.`)) {
      this.store.apagar(cur.id);
      this.ui.toast('Ficha apagada');
    }
  }

  async login(): Promise<void> {
    try {
      await this.fb.login();
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
        console.error(e);
        this.ui.toast('Não foi possível entrar: ' + (code || (e as Error).message), 5000);
      }
    }
  }

  async logout(): Promise<void> {
    this.store.flush();
    await this.fb.logout();
  }

  // ----- arrastar e soltar em qualquer lugar da página -----
  @HostListener('document:dragenter', ['$event'])
  onDragEnter(e: DragEvent): void {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    this.dragDepth++;
    this.dragging.set(true);
  }
  @HostListener('document:dragover', ['$event'])
  onDragOver(e: DragEvent): void {
    if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
  }
  @HostListener('document:dragleave', ['$event'])
  onDragLeave(e: DragEvent): void {
    if (!e.dataTransfer?.types.includes('Files')) return;
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (!this.dragDepth) this.dragging.set(false);
  }
  @HostListener('document:drop', ['$event'])
  onDrop(e: DragEvent): void {
    if (!e.dataTransfer?.files.length) return;
    e.preventDefault();
    if (!this.store.sistema()) { this.dragDepth = 0; this.dragging.set(false); this.ui.toast('Escolha o RPG antes de importar'); return; }
    this.dragDepth = 0;
    this.dragging.set(false);
    this.importar(Array.from(e.dataTransfer.files));
  }
}
