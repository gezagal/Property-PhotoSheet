# Property PhotoSheet

Egyszerű, böngészőben futó fotólap-generátor ingatlan-értékbecslésekhez.

## Funkciók

- több JPG/PNG kép betöltése fájlválasztóval, drag-and-droppal vagy mobilkamerából;
- képek automatikus átméretezése és JPEG-tömörítése a böngészőben;
- képek törlése és sorrendjük átrendezése húzással;
- szabad vagy automatikusan kiegészített képfeliratok;
- lakás- és házsablon a tipikus fotósorrend gyors kitöltéséhez;
- élő miniatűr- és A4-es lapelőnézet, oldalanként 6 fotóval;
- PDF-export címmel, helyrajzi számmal és oldalszámozással;
- a teljes munka mentése JSON-fájlba és későbbi visszatöltése.

## Használat

Nyisd meg az `index.html` fájlt egy modern böngészőben. Build vagy telepítés nem szükséges.

A PDF-generáláshoz az alkalmazás a jsPDF 2.5.1 böngészős csomagját tölti be a cdnjs CDN-ről, ezért ehhez internetkapcsolat szükséges.

## Adatkezelés

A fotók és a kitöltött adatok a böngészőben kerülnek feldolgozásra. Az alkalmazás nem tartalmaz szervert és nem tölt fel adatot saját háttérrendszerbe. A PDF-könyvtár külső CDN-ről töltődik be.

## Technológia

Egyetlen, függőségkezelő és buildlépés nélküli HTML/CSS/JavaScript alkalmazás.

