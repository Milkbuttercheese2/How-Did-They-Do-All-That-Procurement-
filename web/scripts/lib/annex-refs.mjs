// 텍스트에서 별표·별지(서식) 참조를 추출한다.
//
// 귀속 가드가 핵심이다. 조문은 남의 법령 별표를 인용하는 일이 흔하다 —
// 하자담보책임기간(계약법 시행규칙 제70조)은 "「건설산업기본법 시행령」 제30조 및
// [별표 4]에 따른 기간"처럼 타법 별표를 여덟 개 넘게 끌어온다. 이때 별표 번호만
// 보고 조문의 소속 법령으로 귀속하면, 하필 그 법령에 같은 번호의 별표(과징금
// 부과기준 별표 4)가 있어서 전혀 다른 별표가 연결된다. 그래서 참조 직전의
// 「법령명」 인용을 보고, 있으면 그쪽 소속으로 귀속한다(그 별표를 우리가 수집하지
// 않았다면 자연히 매칭에서 떨어진다).

/** "(계약예규) 공사계약일반조건" 같은 접두어는 법령명 대조에 방해가 된다. */
export function normalizeLawName(name) {
  return String(name ?? "").replace(/^\([^)]*\)\s*/, "").trim();
}

const PATTERNS = [
  // "별지 제1호서식", "별지 제2호의4서식"
  { re: /별지\s*제?\s*(\d+)호(?:의\s*(\d+))?\s*서식/g, kind: "별지" },
  // "[별지 1]", "[별지 1의 2]" — 행정규칙 표기
  { re: /\[별지\s*(\d+)(?:의\s*(\d+))?\]/g, kind: "별지" },
  // "별표 2", "별표 3의2", "[별표 4]"
  { re: /별표\s*(\d+)(?:의\s*(\d+))?/g, kind: "별표" },
];

/**
 * 참조 직전 문맥에서 소속 법령을 판정한다.
 *
 * 마지막 「…」 인용이 문장 경계("다." 또는 줄바꿈) 없이 참조와 이어져 있으면
 * 그 인용된 법령 소속으로 본다. 아니면 조문의 소속 법령(ownLaw)이다.
 */
function attributeLaw(text, matchIndex, ownLaw) {
  const before = text.slice(Math.max(0, matchIndex - 60), matchIndex);
  const quoted = [...before.matchAll(/「([^」]+)」/g)];
  if (quoted.length === 0) return ownLaw;
  const last = quoted[quoted.length - 1];
  const between = before.slice(last.index + last[0].length);
  if (/다\.|\n/.test(between)) return ownLaw;
  return last[1].trim();
}

/**
 * @param {string} text 조문·요지 등 검사할 텍스트
 * @param {string} ownLaw 그 텍스트가 속한 법령명
 * @returns {{law: string, annex: string}[]} 중복 제거된 참조 목록
 */
export function extractAnnexRefs(text, ownLaw) {
  const own = normalizeLawName(ownLaw);
  const found = new Map();
  for (const { re, kind } of PATTERNS) {
    re.lastIndex = 0;
    for (const m of String(text ?? "").matchAll(re)) {
      const annex = `${kind}${m[1]}${m[2] ? `의${m[2]}` : ""}`;
      const law = attributeLaw(text, m.index, own);
      found.set(`${law}::${annex}`, { law, annex });
    }
  }
  return [...found.values()];
}

/** DRF 별표번호("000302") → "별표3의2" / 서식이면 "별지3의2" */
export function decodeAnnexNo(raw, kind = "별표") {
  const n = String(raw ?? "").padStart(6, "0");
  const main = parseInt(n.slice(0, 4), 10);
  const sub = parseInt(n.slice(4), 10);
  if (!main) return "";
  const head = kind === "서식" || kind === "별지" ? "별지" : "별표";
  return `${head}${main}${sub ? `의${sub}` : ""}`;
}

/** 화면 표시용 라벨. 법령 서식은 "별지 제N호서식", 행정규칙 서식은 "별지 N" 표기. */
export function annexLabel(annex, kind, isAdmRule) {
  if (kind !== "서식") return annex;
  const body = annex.replace(/^별지/, "");
  return isAdmRule ? `별지 ${body.replace("의", "의 ")}` : `별지 제${body}호서식`;
}
