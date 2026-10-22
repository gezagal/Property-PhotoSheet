# Property PhotoSheet

Telepíthető, offline használható ingatlan-fotólap készítő értékbecslésekhez.
Windows az elsődleges célplatform, az érintőképernyős használat iPhone-on is támogatott.

Felhasználói leírás: [`public/user-guide.html`](public/user-guide.html)

## Funkciók

- több kép betöltése, Windowsos drag & drop vagy közvetlen fényképezés;
- automatikus átméretezés és JPEG-tömörítés;
- külön sorrendszerkesztő ablak, Windows alatt húzással, mobilon fel/le gombokkal;
- kijelölt fotók csoportos áthelyezése húzással, az egymáshoz viszonyított sorrend megtartásával;
- húzás közben halványkék üres keretes helyelőnézet a sorrendszerkesztőben és a fotósorok listájában, a többi elem odébb rendezésével; sikeres áthelyezés után automatikus kijelöléstörlés;
- képre kattintásos kijelölés a sorrendszerkesztőben, finoman animált átrendezés mindkét fotónézetben (a csökkentett mozgás beállítását tiszteletben tartva);
- az összes betöltött kép egy művelettel, megerősítés után törölhető;
- szabad, beépített és felhasználó által bővíthető képfeliratok;
- külön AI-javaslat gomb az üres feliratú képek felismeréséhez;
- saját feliratok tárolása a böngésző `localStorage` tárában;
- saját feliratok hordozása az exportált JSON-munkafájlban;
- szerkeszthető és átrendezhető lakás- és házsablon;
- sablonbeállítások tárolása `localStorage`-ban és hordozása a JSON-munkafájlban;
- hat fotós A4 PDF, magyar ékezeteket támogató betűkészlettel és tördelhető feliratokkal;
- automatikus PDF-képtömörítés: 5 MB célméret, legfeljebb 6 MB; a munkában tárolt képek változatlanok maradnak;
- reszponzív PDF-előnézet;
- JSON-munkafájl import és export;
- automatikus helyi mentés IndexedDB-be;
- telepíthető és offline használható PWA;
- az AI-feliratjavaslat kivételével minden adat és fotó az eszközön marad.

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

## PWA telepítés

Az alkalmazás manifestjét és service workerét a `vite-plugin-pwa` generálja. A telepítési felület a böngésző `beforeinstallprompt` eseményét használja; iOS-en a felhasználó a Safari „Főképernyőhöz adás” funkcióját használhatja. A részletes felhasználói lépések a külön használati útmutatóban találhatók.

## Netlify deploy

A repository gyökerében található `netlify.toml` rögzíti a szükséges beállításokat:

- build parancs: `pnpm build`;
- publikált mappa: `dist`;
- Node.js: 22;
- pnpm: 10.

### A meglévő Netlify projekt összekötése GitHubbal

1. Nyisd meg a `precious-valkyrie-863b84` projektet a Netlify felületén.
2. Nyisd meg a **Project configuration → Developer settings → Continuous deployment → Repository** részt.
3. Válaszd a repository csatolását vagy a jelenlegi repository módosítását.
4. Git-szolgáltatóként válaszd a GitHubot.
5. Ha a Netlify GitHub App még nem fér hozzá, a GitHub engedélykérő oldalán adj neki hozzáférést kizárólag a `gezagal/Property-PhotoSheet` privát repositoryhoz.
6. Production branchként válaszd a `main` branchet.
7. A base directory maradjon üres, mert a projekt a repository gyökerében van.
8. A build command és publish directory mezőket a `netlify.toml` automatikusan beállítja. Ha a felület mégis kéri őket, add meg a `pnpm build` és `dist` értékeket.
9. Indítsd el az első deployt.

Ezután minden `main` branchre pusholt commit automatikus production deployt indít. A pull requestekhez a Netlify deploy previewt készíthet.

Privát repository esetén normál esetben nincs szükség külön deploy keyre: a Netlify GitHub App kap olvasási jogosultságot. Deploy key csak privát Git submodule vagy speciális hozzáférési helyzet esetén szükséges.

### AI-feliratjavaslat

Az **AI javaslat** gomb csak az üres feliratú képeket küldi el elemzésre az OpenAI API-n keresztül. A felhasználó saját és beépített feliratlistájából választ; bizonytalan esetben üresen hagyja a feliratot. Az API-kulcsot kizárólag szerveroldali Netlify Function használja.

A gomb lenyíló menüjében az **OpenAI (fizetős)** opció külön költség- és adattovábbítási megerősítést kér. Megszakításkor nem indul API-kérés. A **Local AI (inaktív)** opció látható, de a helyi AI bekötéséig letiltott. Az OpenAI-nak legfeljebb 300 kB-os, maximum 1280 pixel hosszabb oldalú képmásolatokat küldünk; a munkában tárolt képek nem változnak.

Netlify-ban állítsd be az `OPENAI_API_KEY` környezeti változót a projekt környezeti változói között, majd készíts új deployt. Helyi próbához az alkalmazás gyökerében lévő, Git által figyelmen kívül hagyott `.env` fájlban add meg ugyanezt a változót. A kulcsot ne tedd a kliensoldali kódba, és ne commitold.

Helyi beállítás:

1. Másold a [`.env.example`](.env.example) fájlt `.env` néven a projekt gyökerébe, a `package.json` mellé, ne az `src` mappába.
2. Add meg a saját kulcsodat az `OPENAI_API_KEY=` után. Ne használj `VITE_` előtagot.
3. Indítsd újra a `pnpm dev` szervert. A helyi AI-végpontot a Vite fejlesztői middleware szolgálja ki; a `pnpm preview` önmagában nem futtat Netlify Functions végpontokat.

Netlify-on a kulcsot a projekt **Environment variables** beállításában add meg `OPENAI_API_KEY` néven, a Functions futtatásához és a megfelelő deploy-környezethez engedélyezve, majd indíts új deployt. A helyi `.env` nem kerül feltöltésre. Kulcs nélkül a többi funkció működik, de az OpenAI-javaslat konfigurációs hibát jelez.

A modell jelenleg a [`netlify/functions/suggest-label.ts`](netlify/functions/suggest-label.ts) kódjában rögzített `gpt-4.1-mini`, kérésenként legfeljebb 100 válasz-token mellett. Nincs modellválasztó vagy alkalmazáson belüli pénzügyi keret. A bemeneti szöveg és a kép feldolgozása is fizetős; a képfájl méretkorlátja nem jelent költségkorlátot.

Az AI funkció internetkapcsolatot igényel, képenként API-költséggel jár, és a képeket az OpenAI adatkezelési feltételei szerint továbbítja. A helyi mentés és a többi funkció ettől függetlenül működik offline. Az [OpenAI Platform](https://platform.openai.com/settings/) felületén állíts be költési korlátot, és ellenőrizd, hogy az valóban leállítja-e a kéréseket, nem csak értesít. Nyilvános deploy esetén a Function végpont jelenleg nem kér bejelentkezést és nincs saját kéréskorlátozása; a felületi megerősítés nem védi a végpontot közvetlen hívásoktól. A privát GitHub-repository nem teszi priváttá a Netlify alkalmazást.

### PDF-méret

A PDF-generálás a tárolt képektől független JPEG-másolatokat készít, maximum 1200 pixel hosszabb oldallal és a képszámhoz igazított méretkerettel. A tényleges dokumentumméretet ellenőrzi, és szükség esetén újragenerálja kisebb képekkel. A cél 5 000 000 bájt; a felső korlát 6 000 000 bájt. Ha a korlát nem teljesíthető, hibaüzenet jelenik meg a túl nagy fájl mentése helyett. Sok kép esetén a PDF felbontása és képminősége csökkenhet. A JSON-munkafájl és az AI számára készített másolatok nem a PDF tömörített képeiből készülnek.

## Technológia

- Vite;
- Netlify Functions;
- strict TypeScript;
- vanilla DOM API;
- jsPDF;
- vite-plugin-pwa és Workbox;
- IndexedDB és localStorage.

## Adatkezelés

A munkamenet a böngésző helyi IndexedDB-adatbázisában, a saját feliratlista és a sablonok localStorage-ban tárolódnak. A hagyományos fotólapkészítés nem tölti fel a képeket vagy ingatlanadatokat. Kivétel az explicit megerősített OpenAI-javaslat: az üres feliratú képek tömörített másolatait és a választható feliratlistát a szerveroldali Netlify Function az OpenAI szolgáltatásának továbbítja. A cím és a helyrajzi szám nem része az AI-kérésnek. A helyi fotólapkészítés az első sikeres betöltés után offline is működik; az OpenAI-javaslat nem.
