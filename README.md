# Property PhotoSheet

Telepíthető, offline használható ingatlan-fotólap készítő értékbecslésekhez.
Windows az elsődleges célplatform, az érintőképernyős használat iPhone-on is támogatott.

## Funkciók

- több kép betöltése, Windowsos drag & drop vagy közvetlen fényképezés;
- automatikus átméretezés és JPEG-tömörítés;
- Windows alatt húzással, mobilon fel/le gombokkal használható sorrendezés;
- szabad, beépített és felhasználó által bővíthető képfeliratok;
- saját feliratok tárolása a böngésző `localStorage` tárában;
- saját feliratok hordozása az exportált JSON-munkafájlban;
- lakás- és házsablon;
- hat fotós A4 PDF, tördelhető feliratokkal;
- reszponzív PDF-előnézet;
- JSON-munkafájl import és export;
- automatikus helyi mentés IndexedDB-be;
- telepíthető és offline használható PWA;
- minden ingatlanadat és fotó az eszközön marad.

## Helyi fejlesztés

Követelmény: Node.js 22 vagy újabb és pnpm 10.

```bash
pnpm install
pnpm dev
```

Production build és helyi előnézet:

```bash
pnpm build
pnpm preview
```

## Alkalmazás telepítése

Az alkalmazás PWA-ként (Progressive Web App) telepíthető. Ez nem hagyományos Windows `.exe`: ugyanaz a webalkalmazás indul el különálló, böngészőkeret nélküli ablakban.

### Windows

Chrome vagy Edge alatt a **Telepítés** gomb:

- megnyitja a böngésző telepítési párbeszédét;
- telepítés után elérhetővé teheti az alkalmazást a Start menüben és az asztalon;
- külön ablakban, böngésző címsora nélkül indítja el;
- az első sikeres betöltés után lehetővé teszi az offline használatot.

### iPhone

Az iOS nem engedi, hogy a weboldal közvetlenül megnyissa a telepítési párbeszédet. A **Telepítés** gomb ezért az alábbi lépéseket jelzi:

1. Nyisd meg az alkalmazást Safariban.
2. Koppints a **Megosztás** gombra.
3. Válaszd a **Főképernyőhöz adás** lehetőséget.

Ezután az alkalmazás a főképernyőn megjelenő ikonról, önálló ablakban indítható.

A Telepítés gomb csak akkor jelenik meg, ha az adott böngésző telepíthetőnek ítéli az alkalmazást, illetve iPhone-on akkor, ha még nem telepített módban fut. A telepített alkalmazásban a gomb általában nem látható.

A telepítés és az offline gyorsítótárazás nem tölti fel a fotókat vagy az ingatlanadatokat: ezek továbbra is az adott eszközön maradnak.

## Netlify deploy

A repository gyökerében található `netlify.toml` rögzíti a szükséges beállításokat:

- build parancs: `pnpm build`;
- publikált mappa: `dist`;
- Node.js: 22;
- pnpm: 10.

### A meglévő Netlify projekt összekötése GitHubbal

1. Nyisd meg a `precious-valkyrie-863b84` projektet a Netlify felületén.
2. Nyisd meg a **Project configuration → Build & deploy → Continuous deployment → Repository** részt.
3. Válaszd a repository csatolását vagy a jelenlegi repository módosítását.
4. Git-szolgáltatóként válaszd a GitHubot.
5. Ha a Netlify GitHub App még nem fér hozzá, a GitHub engedélykérő oldalán adj neki hozzáférést kizárólag a `gezagal/Property-PhotoSheet` privát repositoryhoz.
6. Production branchként válaszd a `main` branchet.
7. A base directory maradjon üres, mert a projekt a repository gyökerében van.
8. A build command és publish directory mezőket a `netlify.toml` automatikusan beállítja. Ha a felület mégis kéri őket, add meg a `pnpm build` és `dist` értékeket.
9. Indítsd el az első deployt.

Ezután minden `main` branchre pusholt commit automatikus production deployt indít. A pull requestekhez a Netlify deploy previewt készíthet.

Privát repository esetén normál esetben nincs szükség külön deploy keyre: a Netlify GitHub App kap olvasási jogosultságot. Deploy key csak privát Git submodule vagy speciális hozzáférési helyzet esetén szükséges.

## Technológia

- Vite;
- strict TypeScript;
- vanilla DOM API;
- jsPDF;
- vite-plugin-pwa és Workbox;
- IndexedDB és localStorage.

## Adatkezelés

Az alkalmazás nem tartalmaz szervert, és nem tölt fel fotókat vagy ingatlanadatokat. A munkamenet a böngésző helyi IndexedDB-adatbázisában, a saját feliratlista localStorage-ban tárolódik. A build minden futásidejű függőséget helyben csomagol, ezért az alkalmazás az első sikeres betöltés után offline is működik.
