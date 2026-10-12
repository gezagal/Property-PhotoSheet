export const BUILT_IN_LABELS = [
  'Akna / szellőző',
  'Bal oldali szomszéd',
  'Bal oldali szomszéd házszám',
  'Beazonosíthatóság',
  'Bejárat',
  'Bejárati ajtó',
  'Bejárati előtér',
  'Bojler / vízmelegítő',
  'Dolgozószoba',
  'Elektromos fűtőkazán',
  'Elektromos tábla / elosztószekrény',
  'Elosztószekrény',
  'Előszoba',
  'Épület bejárata',
  'Épület gázóra',
  'Erkély',
  'Étkező',
  'Folyosó',
  'Fürdőszoba',
  'Fürdőszoba - részlet',
  'Fürdőszobai radiátor / törölközőszárító',
  'Fürdőszobai termosztát',
  'Garázs',
  'Gardrób / beépített szekrény',
  'Gázkazán / gázcirkó',
  'Gázóra',
  'Gyerekszoba',
  'Hálószoba',
  'Hálószoba - másik nézet',
  'Homlokzat',
  'Homlokzat - oldalnézet',
  'Homlokzat - részlet',
  'Hőközpont',
  'Hőközpont - másik nézet',
  'Hőmennyiségmérő',
  'Hőszivattyú - beltéri egység',
  'Hőszivattyú - kültéri egység',
  'Jellemző nyílászáró',
  'Jellemző nyílászáró - részlet',
  'Jobb oldali szomszéd',
  'Jobb oldali szomszéd házszám',
  'Kapucsengő panel',
  'Kazánszoba',
  'Kert',
  'Kert - részlet',
  'Kerékpártároló',
  'Klíma - beltéri egység',
  'Klíma - kültéri egység',
  'Konyha',
  'Konyha - másik nézet',
  'Konyhai csatlakozások',
  'Konyhai kiállások',
  'Közlekedő',
  'Közös helyiség',
  'Lakás bejárata',
  'Lakások elhelyezkedése',
  'Lépcső',
  'Lépcsőház',
  'Lépcsőház - lift',
  'Lift ajtó',
  'Lift kabin',
  'Loggia',
  'Mennyezeti osztó-gyűjtő',
  'Mérőhely szekrény',
  'Nappali',
  'Nappali - másik nézet',
  'Nappali termosztát',
  'Nappali-konyha-étkező',
  'Nyílászáró',
  'Okos termosztát',
  'Padlófűtés osztó-gyűjtő',
  'Parkoló',
  'Pince',
  'Radiátor',
  'Szoba',
  'Szoba 2',
  'Szoba 3',
  'Szoba 4',
  'Szoláris rendszer',
  'Szeméttároló',
  'Szellőztető rendszer',
  'Tároló',
  'Terasz',
  'Termosztát',
  'Utcakép',
  'Veranda',
  'Villanyóra',
  'Villanyóra - almérő',
  'Vill. almérők helye emeleti közlekedőben',
  'Víz- és hőmennyiség mérőórák',
  'Vízóra',
  'WC',
  'WC - részlet',
] as const;

export type TemplateName = 'lakás' | 'ház';

export interface PhotoTemplates {
  lakás: string[];
  ház: string[];
}

export const DEFAULT_TEMPLATES: PhotoTemplates = {
  lakás: [
    'Utcakép', 'Homlokzat', 'Homlokzat', 'Jobb oldali szomszéd',
    'Jobb oldali szomszéd házszám', 'Épület bejárata', 'Bejárati előtér',
    'Lépcsőház', 'Lépcsőház - lift', 'Lakások elhelyezkedése', 'Lakás bejárata',
    'Előszoba', 'Nappali', 'Konyha', 'Konyhai kiállások', 'Fürdőszoba',
    'Fürdőszobai radiátor / törölközőszárító', 'Fürdőszobai termosztát', 'WC',
    'Hálószoba', 'Terasz', 'Nappali - másik nézet', 'Nappali termosztát',
    'Jellemző nyílászáró', 'Elektromos tábla / elosztószekrény',
    'Padlófűtés osztó-gyűjtő', 'Vill. almérők helye emeleti közlekedőben',
    'Víz- és hőmennyiség mérőórák', 'Épület gázóra', 'Hőközpont',
    'Hőközpont - másik nézet',
  ],
  ház: [
    'Utcakép', 'Homlokzat', 'Homlokzat - oldalnézet', 'Bal oldali szomszéd',
    'Jobb oldali szomszéd', 'Épület bejárata', 'Előszoba', 'Nappali', 'Konyha',
    'Fürdőszoba', 'WC', 'Hálószoba', 'Gyerekszoba', 'Terasz', 'Kert', 'Garázs',
    'Gázkazán / gázcirkó', 'Termosztát', 'Radiátor',
    'Elektromos tábla / elosztószekrény', 'Villanyóra', 'Gázóra', 'Vízóra',
  ],
};

const collator = new Intl.Collator('hu', { sensitivity: 'base' });

export function normalizeCustomLabels(values: unknown): string[] {
  if (!Array.isArray(values)) return [];

  const unique = new Map<string, string>();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const label = value.trim().replace(/\s+/g, ' ').slice(0, 100);
    if (!label) continue;
    unique.set(label.toLocaleLowerCase('hu'), label);
  }

  return [...unique.values()].sort(collator.compare);
}

export function allLabels(customLabels: string[]): string[] {
  return normalizeCustomLabels([...BUILT_IN_LABELS, ...customLabels]);
}

function normalizeTemplateItems(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];

  return value
    .slice(0, 200)
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().replace(/\s+/g, ' ').slice(0, 100));
}

export function normalizeTemplates(
  value: unknown,
  fallback: PhotoTemplates = DEFAULT_TEMPLATES,
): PhotoTemplates {
  if (!value || typeof value !== 'object') {
    return {
      lakás: [...fallback.lakás],
      ház: [...fallback.ház],
    };
  }

  const candidate = value as Partial<Record<TemplateName, unknown>>;
  return {
    lakás: normalizeTemplateItems(candidate.lakás, fallback.lakás),
    ház: normalizeTemplateItems(candidate.ház, fallback.ház),
  };
}
