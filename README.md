# Property PhotoSheet

Telepíthető, offline használható ingatlan-fotólap készítő értékbecslésekhez.

## Kipróbálás

A publikált alkalmazás: **https://gezagal.github.io/Property-PhotoSheet/**

iPhone-on Safariban nyisd meg, majd válaszd a **Megosztás → Főképernyőhöz adás** lehetőséget.

## Funkciók

- több kép betöltése vagy közvetlen fényképezés;
- automatikus átméretezés és tömörítés;
- érintésbarát sorrendezés;
- szabad és előre definiált képfeliratok;
- lakás- és házsablon;
- hat fotós A4 PDF, valódi, tördelhető szöveggel;
- PDF-előnézet;
- JSON-munkafájl import és export;
- automatikus helyi mentés IndexedDB-be;
- telepíthető és offline használható PWA;
- minden adat az eszközön marad.

## Fejlesztés

```bash
pnpm install
pnpm dev
```

Production build: `pnpm build`, majd `pnpm preview`.

## Technológia

Vanilla TypeScript, Vite, vite-plugin-pwa/Workbox, IndexedDB és jsPDF.

## Adatkezelés

Az alkalmazás nem tartalmaz szervert, és nem tölt fel fotókat vagy ingatlanadatokat. A munkamenet a böngésző helyi IndexedDB-adatbázisában tárolódik. A build minden futásidejű függőséget helyben csomagol, ezért az alkalmazás az első betöltés után offline is működik.

