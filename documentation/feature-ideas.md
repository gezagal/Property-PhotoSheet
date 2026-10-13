# Feature ideas

## #1 — Lokális AI-képfelismerés

**Állapot:** Draft

**Jelenlegi felület:** az AI javaslat lenyíló menüjében az OpenAI (fizetős) külön megerősítést kér; a Local AI (inaktív) látható, de letiltott. A helyi modell futtatása még nincs implementálva. Az alábbi UI-ötletek korábbi alternatívák, nem a jelenlegi működés leírásai.

### Ötlet

Az üres feliratú ingatlanfotókhoz a böngészőben, helyben futó képfelismerő adjon feliratjavaslatot az alkalmazás beépített és saját feliratlistájából. A helyi mód képei ne kerüljenek külső AI-szolgáltatáshoz. Ez az OpenAI-alapú, már implementált AI-javaslat **mellett**, attól külön választható funkció legyen; egyik mód se induljon el automatikusan a másik helyett.

### Lehetséges megközelítés

- A PWA a szükséges JavaScript-függőségeket az alkalmazással szállítja; a felhasználónak ne kelljen Python-, PyTorch- vagy más futtatókörnyezetet telepítenie.
- A modell ONNX-változata böngészőben, például Transformers.js és ONNX Runtime Web segítségével futhat.
- A modell súlyai első használatkor igény szerint töltődjenek le, majd gyorsítótárazhatók legyenek későbbi, akár offline használatra.
- Első lépésként zero-shot osztályozás pontozhatja a feliratlistát. Ez nem saját, felügyelten tanított classifier: annak betanításához megfelelően címkézett példaképek és külön tanítási/exportfolyamat szükséges.
- A bizonytalan eredmény ne írjon automatikusan feliratot; a meglévő kézi feliratok maradjanak érintetlenek.
- **UI-javaslat az első verzióhoz:** két egyértelmű, külön gomb a felirat eszköztárában: **AI javaslat (OpenAI)** és **AI javaslat (helyi)**. A helyi gomb mellett legyen rövid adatvédelmi jelzés, modellletöltéskor pedig méret-/állapotjelzés. Ez elkerüli, hogy a felhasználó véletlenül külső szolgáltatásnak küldjön képet.
- Alternatívaként egy **AI javaslat** legördülőválasztóban lehet módot választani: **OpenAI (felhő)** vagy **Helyi modell (ezen az eszközön)**. Ha ezt választjuk, a kiválasztott mód legyen látható a főgomb feliratában, és kezdeti választás ne küldjön képet; az első használat előtt jelezze a helyi modell letöltését. Ne legyen rejtett, tartós módváltás.

### Használható modelljelöltek (előzetes kutatás)

| Modell | Böngészős futtatás és hozzávetőleges súlyméret | Licenc / kockázat | Előzetes értékelés |
|---|---|---|---|
| **MobileCLIP-S0** (`Xenova/mobileclip_s0`) | Transformers.js-kompatibilis ONNX-export található. A közölt kvantált ONNX-fájlok nagyságrendileg 11.8 MB (képi) + 42.8 MB (szöveges), együtt kb. 55 MB; az adott modellváltozat és tokenizer betöltését ellenőrizni kell. | Az Apple eredeti súlyainak licence kizárólag nem kereskedelmi kutatásra szól, és kifejezetten kizárja a termékfejlesztést/kereskedelmi termékben vagy szolgáltatásban való használatot. Az ONNX-konverzió ezt a súlylicencet nem írja felül. | Technikailag vonzó, kis méretű jelölt; munkához tervezett funkcióhoz **ne válasszuk**, amíg nincs írásos licencengedély vagy egyértelmű jogi tisztázás. |
| **OpenAI CLIP ViT-B/32** (`Xenova/clip-vit-base-patch32`) | ONNX-változat elérhető, Transformers.js zero-shot pipeline-t támogat; a keresésben talált kvantált képi encoder kb. 89 MB, és ehhez a szövegmodell/tokenizer is kell. A teljes letöltést mérni kell. | Az OpenAI/CLIP kód MIT licencű; a modellkártya külön figyelmeztet arra, hogy telepített felhasználási esetek nincsenek értékelve. A használt ONNX-repozitórium és súlyok licencét önállóan ellenőrizni kell, nem elég a forráskód licencét feltételezni. | Jó technikai baseline és ismert Transformers.js út, de a tényleges repó/licenc, méret és feladatbeli pontosság ellenőrzése szükséges. |
| **SigLIP 2 Base** (`google/siglip2-base-patch16-224`) | Zero-shot képosztályozásra alkalmas; találtak közösségi ONNX-exportokat, de azok nem hivatalosak. Egy NaFlex export fp16 változata kb. 202 MB képi + 565 MB szöveges encoder, összesen kb. 767 MB. | Az eredeti Hugging Face modellkártya Apache-2.0-t jelez; ettől külön kell ellenőrizni a használt konverziót, súlyforrást és függőségeket. | Potenciálisan jobb minőségű baseline, de a nagy letöltés és nem hivatalos export miatt PWA első választásának nem ideális. |
| **TinyCLIP** (Microsoft/Cream vagy közösségi Hugging Face checkpointok) | Kisebb CLIP-család; vizsgált találatokban nem igazolódott kész, Transformers.js-hez megfelelő ONNX-export és megbízható böngészős méretmérés. | A Microsoft/Cream kód MIT licencűként jelenik meg, de minden konkrét checkpoint súlylicencét és az adathalmazokra vonatkozó feltételeket külön kell ellenőrizni. | Érdemes későbbi jelöltként megvizsgálni; csak konverzió, licenc-ellenőrzés és mobilböngészős benchmark után. |

**Előzetes irány:** MobileCLIP-S0-t a súlylicenc korlátozása miatt kizárni a munkacélú kiadásból. Elsőként a Transformers.js-szel való tényleges kompatibilitást és a kvantált ONNX-modelllicencet külön ellenőrző CLIP ViT-B/32 prototípust, valamint összehasonlító SigLIP 2 benchmarkot érdemes vizsgálni. Ez még nem végleges modellválasztás.

### Korlátok és nyitott kérdések

- A felhasználónak nem kellene függőségeket telepítenie, de az első modellletöltés több tíz vagy akár több száz MB lehet; a méret, betöltési idő és offline cache viselkedés modellfüggő.
- A magyar feliratok és a hasonló kategóriák — például „Nappali” és „Nappali – másik nézet” — pontosságát reprezentatív ingatlanfotókon kell mérni.
- A legtöbb CLIP-szerű modell szövegképi hasonlóságot pontoz, nem magyar ingatlanfotókra betanított zárt osztályozó. Magyar címkékhez prompt-/címkevariánsok tesztelése, pontszámküszöb és második legjobb pontszámtól vett margin kell; a confidence score önmagában nem garantált valószínűség.
- A súlyok ne kerüljenek automatikusan a kezdeti PWA-cache-be; első helyi használatkor legyenek letölthetők és csak explicit felhasználói beleegyezéssel gyorsítótárazhatók.
- Android/iOS és desktop böngészőn mérni kell a WASM CPU és az elérhető WebGPU backend teljesítményét, memóriáját és kompatibilitását. WebGPU gyorsíthat, de nem tekinthető minden eszközön garantáltnak.

### Hivatkozások

- [Apple MobileCLIP hivatalos kód és modelllicencek](https://github.com/apple-aiml-research/ml-mobileclip)
- [Apple MobileCLIP modellek licencszövege](https://github.com/apple-aiml-research/ml-mobileclip/blob/main/LICENSE_MODELS)
- [MobileCLIP-S0 ONNX/Transformers.js export](https://huggingface.co/Xenova/mobileclip_s0)
- [Transformers.js zero-shot image classification](https://huggingface.co/docs/transformers.js/en/tasks/zero_shot_image_classification)
- [ONNX Runtime Web: WebGPU execution provider és kompatibilitás](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html)
- [OpenAI CLIP kódlicenc](https://github.com/openai/CLIP/blob/main/LICENSE)
- [OpenAI CLIP ViT-B/32 modellkártya](https://huggingface.co/openai/clip-vit-base-patch32)
- [Transformers.js CLIP ViT-B/32 ONNX export](https://huggingface.co/Xenova/clip-vit-base-patch32)
- [Google SigLIP 2 Base modellkártya/licenc](https://huggingface.co/google/siglip2-base-patch16-224)
- [Példa közösségi SigLIP 2 ONNX exportra](https://huggingface.co/upshift/siglip2-base-patch16-naflex-onnx)
- [Microsoft TinyCLIP kód és modellcsalád](https://github.com/microsoft/Cream/tree/main/TinyCLIP)

*A modellek és licencmetaadatok előzetes áttekintése: 2026-10-13. A modellkártyák és fájlméretek változhatnak; kiadás előtt ellenőrizni kell a kiválasztott súlyfájl pontos licencét, forrását és hashét. Ez nem jogi tanács.*
