// route.ts(TS)가 스크립트와 같은 추출 로직을 쓰기 위한 선언.
// 로직은 annex-refs.mjs 한 곳에만 둔다 — 귀속 가드가 두 벌이 되면 반드시 어긋난다.
export function normalizeLawName(name: string | null | undefined): string;
export function extractAnnexRefs(
  text: string | null | undefined,
  ownLaw: string,
): { law: string; annex: string }[];
export function decodeAnnexNo(raw: string | number, kind?: string): string;
export function annexLabel(annex: string, kind: string, isAdmRule: boolean): string;
