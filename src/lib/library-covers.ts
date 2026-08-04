export interface LibraryCoverPreset {
  id: string
  label: string
  src: string
}

const libraryCoverPresets = [
  {
    id: 'cover-01',
    label: '内置书皮 01',
    src: new URL('../assets/library-covers/cover-01.webp', import.meta.url).href,
  },
  {
    id: 'cover-02',
    label: '内置书皮 02',
    src: new URL('../assets/library-covers/cover-02.webp', import.meta.url).href,
  },
  {
    id: 'cover-03',
    label: '内置书皮 03',
    src: new URL('../assets/library-covers/cover-03.webp', import.meta.url).href,
  },
  {
    id: 'cover-04',
    label: '内置书皮 04',
    src: new URL('../assets/library-covers/cover-04.webp', import.meta.url).href,
  },
  {
    id: 'cover-05',
    label: '内置书皮 05',
    src: new URL('../assets/library-covers/cover-05.webp', import.meta.url).href,
  },
  {
    id: 'cover-06',
    label: '内置书皮 06',
    src: new URL('../assets/library-covers/cover-06.webp', import.meta.url).href,
  },
  {
    id: 'cover-07',
    label: '内置书皮 07',
    src: new URL('../assets/library-covers/cover-07.webp', import.meta.url).href,
  },
  {
    id: 'cover-08',
    label: '内置书皮 08',
    src: new URL('../assets/library-covers/cover-08.webp', import.meta.url).href,
  },
  {
    id: 'cover-09',
    label: '内置书皮 09',
    src: new URL('../assets/library-covers/cover-09.webp', import.meta.url).href,
  },
  {
    id: 'cover-10',
    label: '内置书皮 10',
    src: new URL('../assets/library-covers/cover-10.webp', import.meta.url).href,
  },
  {
    id: 'cover-11',
    label: '内置书皮 11',
    src: new URL('../assets/library-covers/cover-11.webp', import.meta.url).href,
  },
  {
    id: 'cover-12',
    label: '内置书皮 12',
    src: new URL('../assets/library-covers/cover-12.webp', import.meta.url).href,
  },
] satisfies LibraryCoverPreset[]

const fallbackCoverPreset = libraryCoverPresets[0]
const coverPresetById = new Map(libraryCoverPresets.map((cover) => [cover.id, cover]))

export function getLibraryCoverPreset(coverPreset: string | null | undefined): LibraryCoverPreset {
  return coverPresetById.get(coverPreset ?? '') ?? fallbackCoverPreset
}

export function listLibraryCoverPresets(): LibraryCoverPreset[] {
  return [...libraryCoverPresets]
}
