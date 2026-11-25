# Fichas de RPG

Site em Angular para editar as fichas `.txt` (Status e Mochila) de RPGs de mesa (RPG Dark e RPG Cibo), gerar rolagens para o Roll20 e guardar tudo no Firebase para abrir em qualquer dispositivo.

Publicado em: **https://srgnng4mes.github.io/RPG/**

## Rodando localmente

```bash
npm install
npm start          # http://localhost:4200
npm test           # testes do parser (exportação idêntica, regras, rolagens)
```

Sem Firebase configurado, o site funciona em **modo local** (fichas ficam no `localStorage` do navegador).
Ao entrar com Google, as fichas locais sobem automaticamente para a conta.

## Configurar o Firebase

1. Em <https://console.firebase.google.com> crie um projeto (ou use um existente).
2. **Authentication → Sign-in method**: ative o provedor **Google**.
3. **Authentication → Settings → Domínios autorizados**: adicione **`srgnng4mes.github.io`**
   (`localhost` já vem autorizado).
4. **Firestore Database**: crie o banco (modo produção) e cole as regras de [`firestore.rules`](firestore.rules) na aba *Regras*.
5. **Configurações do projeto → Seus apps → Web (`</>`)**: registre um app e copie o `firebaseConfig`
   para [`src/environments/environment.ts`](src/environments/environment.ts). Esses valores podem ficar públicos — a segurança vem das regras.
6. Faça commit/push: o GitHub Actions publica o site.

Estrutura no Firestore (cada RPG tem dados separados):

- RPG Dark: `users/{uid}/fichas/{fichaId}` e `users/{uid}/config/app`
- Outros RPGs: `users/{uid}/sistemas/{sistema}/fichas/{fichaId}` e `users/{uid}/sistemas/{sistema}/config/app`
- Ficha: `{ nome, status, mochila, atualizadoEm }` (status/mochila são o texto dos `.txt`)
- Config: `{ formulas, stressTeste, stressDano, favoritas, pctDanoCC, pctDanoLA }`

O Firestore usa cache offline (`persistentLocalCache`), então dá para editar com internet instável; sincroniza quando voltar.

## GitHub Pages

O workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) roda os testes, faz o build com `--base-href /RPG/` e publica a cada push na `main`.

Uma única vez: em **Settings → Pages → Build and deployment → Source**, escolha **GitHub Actions**.

## Estrutura

| Arquivo | O que faz |
| --- | --- |
| `src/app/core/ficha-parser.service.ts` | Lê/escreve os `.txt`, regras automáticas e rolagens. Só reescreve linhas editadas. |
| `src/app/core/sistemas.ts` | Os RPGs disponíveis (formato da ficha, regras, rolagens padrão). Para adicionar outro RPG, crie uma entrada aqui. |
| `src/app/core/cibo-parser.ts` | Leitura/escrita das fichas do RPG Cibo. |
| `src/app/core/fichas.store.ts` | Estado das fichas, importação/exportação, salvamento com debounce (800 ms) no Firestore ou localStorage. |
| `src/app/core/firebase.service.ts` | Login Google (`signInWithPopup`) e Firestore. |
| `src/app/core/models.ts` | Fórmulas padrão das rolagens. |
| `src/app/personagem`, `rolagens`, `mochila` | Telas. |

### Fórmulas de rolagem

Editáveis no painel *Rolagens para o Roll20*. Tokens: `prec_cc, prec_la, esq_cc, esq_la, corrida, reacao, reflexo, atk_cc, atk_la, intimidacao, convencer, enganar, stress_teste, stress_dano`.
Exemplo: `{prec_cc}[Precisão CC] - {stress_teste}[Stress]` → `/roll 1d20+4[Precisão CC] - 3[Stress]`.
