// 제도 찾기 라우팅용 슬림 인덱스 생성.
//
// API 라우트가 lib/data(제도 JSON 전체 4.4MB, 조문 원문 884건 포함)를 import 하면
// 서버 번들이 그만큼 커진다. Cloudflare Worker 스크립트 상한이 무료 3 MiB라 그대로는
// 배포가 안 된다. 라우팅에 실제로 필요한 건 이름·분류·요약·적용대상뿐이므로
// (66개 합쳐 약 17KB) 그것만 뽑아 별도 파일로 둔다.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = path.join(WEB_DIR, "data", "institutions");
const OUT_FILE = path.join(WEB_DIR, "data", "routing-index.json");

const entries = fs
  .readdirSync(SRC_DIR)
  .filter((file) => file.endsWith(".json"))
  .map((file) => {
    const d = JSON.parse(fs.readFileSync(path.join(SRC_DIR, file), "utf8"));
    const applicability = d.canvas?.applicability;
    const applicabilityText = Array.isArray(applicability)
      ? applicability.join(" ")
      : typeof applicability === "string"
        ? applicability
        : "";
    return {
      slug: d.slug,
      name: d.name,
      category: d.category ?? "",
      oneLiner: d.oneLiner ?? "",
      applicability: applicabilityText,
    };
  })
  .sort((a, b) => a.slug.localeCompare(b.slug));

fs.writeFileSync(OUT_FILE, JSON.stringify(entries) + "\n");

const bytes = fs.statSync(OUT_FILE).size;
console.log(
  `라우팅 인덱스 생성: ${entries.length}개 제도, ${(bytes / 1024).toFixed(1)}KB → data/routing-index.json`,
);
