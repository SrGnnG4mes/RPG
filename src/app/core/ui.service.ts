import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class UiService {
  readonly toastMsg = signal<string | null>(null);
  private t: ReturnType<typeof setTimeout> | null = null;

  toast(msg: string, ms = 2600): void {
    this.toastMsg.set(msg);
    if (this.t) clearTimeout(this.t);
    this.t = setTimeout(() => this.toastMsg.set(null), ms);
  }

  async copy(text: string, label = 'Copiado'): Promise<void> {
    if (!text) { this.toast('Nada para copiar'); return; }
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    this.toast(`${label}: ${text}`);
  }

  download(nome: string, texto: string): void {
    // UTF-8 (sem BOM), quebras CRLF já vêm do serializador
    const blob = new Blob([new TextEncoder().encode(texto)], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}
