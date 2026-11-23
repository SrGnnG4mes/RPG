import { Injectable, signal } from '@angular/core';
import { FirebaseApp, initializeApp } from 'firebase/app';
import { Auth, GoogleAuthProvider, User, getAuth, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import {
  Firestore, Unsubscribe, collection, deleteDoc, doc, getDoc, initializeFirestore, onSnapshot,
  persistentLocalCache, persistentMultipleTabManager, serverTimestamp, setDoc, writeBatch,
} from 'firebase/firestore';
import { environment } from '../../environments/environment';
import { AppConfig, FichaDoc } from './models';

export interface RemoteFicha extends FichaDoc {
  /** true quando o snapshot ainda contém escrita local não confirmada */
  pending: boolean;
}

@Injectable({ providedIn: 'root' })
export class FirebaseService {
  readonly enabled = !!environment.firebaseConfig.apiKey;
  readonly user = signal<User | null>(null);
  /** true até o Firebase dizer se já existe sessão (evita piscar a tela de "não logado") */
  readonly authLoading = signal(this.enabled);

  private app?: FirebaseApp;
  private auth?: Auth;
  private db?: Firestore;

  constructor() {
    if (!this.enabled) return;
    this.app = initializeApp(environment.firebaseConfig);
    this.auth = getAuth(this.app);
    // cache offline: funciona com internet instável e sincroniza depois
    this.db = initializeFirestore(this.app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      ignoreUndefinedProperties: true, // campos opcionais (ex.: montagem) podem vir undefined
    });
    onAuthStateChanged(this.auth, u => {
      this.user.set(u);
      this.authLoading.set(false);
    });
  }

  async login(): Promise<void> {
    if (!this.auth) throw new Error('Firebase não configurado (src/environments/environment.ts).');
    await signInWithPopup(this.auth, new GoogleAuthProvider());
  }

  async logout(): Promise<void> {
    if (this.auth) await signOut(this.auth);
  }

  watchFichas(uid: string, cb: (fichas: RemoteFicha[]) => void, onError: (e: unknown) => void): Unsubscribe {
    const col = collection(this.db!, 'users', uid, 'fichas');
    return onSnapshot(col, { includeMetadataChanges: true }, snap => {
      cb(snap.docs.map(d => {
        const x = d.data();
        return {
          id: d.id,
          nome: x['nome'] ?? '',
          status: x['status'] ?? '',
          mochila: x['mochila'] ?? '',
          pending: d.metadata.hasPendingWrites,
        };
      }));
    }, onError);
  }

  saveFicha(uid: string, f: FichaDoc): Promise<void> {
    return setDoc(doc(this.db!, 'users', uid, 'fichas', f.id), {
      nome: f.nome, status: f.status, mochila: f.mochila, atualizadoEm: serverTimestamp(),
    });
  }

  async saveFichas(uid: string, fichas: FichaDoc[]): Promise<void> {
    const batch = writeBatch(this.db!);
    fichas.forEach(f => batch.set(doc(this.db!, 'users', uid, 'fichas', f.id), {
      nome: f.nome, status: f.status, mochila: f.mochila, atualizadoEm: serverTimestamp(),
    }));
    await batch.commit();
  }

  deleteFicha(uid: string, id: string): Promise<void> {
    return deleteDoc(doc(this.db!, 'users', uid, 'fichas', id));
  }

  async loadConfig(uid: string): Promise<Partial<AppConfig> | null> {
    const snap = await getDoc(doc(this.db!, 'users', uid, 'config', 'app'));
    return snap.exists() ? (snap.data() as Partial<AppConfig>) : null;
  }

  saveConfig(uid: string, cfg: AppConfig): Promise<void> {
    return setDoc(doc(this.db!, 'users', uid, 'config', 'app'), {
      formulas: cfg.formulas, stressTeste: cfg.stressTeste, stressDano: cfg.stressDano,
      favoritas: cfg.favoritas ?? [],
      pctDanoCC: cfg.pctDanoCC ?? 0,
      pctDanoLA: cfg.pctDanoLA ?? 0,
    }, { merge: true }); // merge: nunca apaga campos já salvos no documento do usuário
  }
}
