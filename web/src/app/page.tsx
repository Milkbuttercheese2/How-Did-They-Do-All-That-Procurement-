import { Suspense } from "react";
import {
  getInstitution,
  getInstitutionSummaries,
  getCategoryOrder,
} from "@/lib/data";
import InstitutionExplorer from "@/components/InstitutionExplorer";
import LawToProcessHero from "@/components/LawToProcessHero";

export default function HomePage() {
  const institutions = getInstitutionSummaries();
  const categoryOrder = getCategoryOrder();
  const eia = getInstitution("environmental-impact-assessment");

  if (!eia?.process) {
    throw new Error("환경영향평가 업무구조도 데이터를 찾을 수 없습니다.");
  }

  const featureNodes = ["P04", "P05", "P13"]
    .map((id) => eia.process?.nodes.find((node) => node.id === id))
    .filter((node): node is NonNullable<typeof node> => Boolean(node));
  const articleVerification = eia.verification?.articleVerification;

  return (
    <>
      <LawToProcessHero
        modelCount={institutions.length}
        lawName={eia.process.law_name ?? "환경영향평가법"}
        checkedAt={articleVerification?.checkedAt ?? eia.asOfDate}
        verifiedReferences={articleVerification?.verifiedReferences ?? 0}
        articleReferences={articleVerification?.articleReferences ?? 0}
        processNodeCount={eia.process.nodes.length}
        nodes={featureNodes}
      />
      <Suspense fallback={<CatalogFallback />}>
        <InstitutionExplorer
          institutions={institutions}
          categoryOrder={categoryOrder}
        />
      </Suspense>
    </>
  );
}

function CatalogFallback() {
  return (
    <section className="institution-explorer" aria-label="제도 카탈로그 불러오는 중">
      <div className="institution-explorer-inner explorer-loading">
        제도 카탈로그를 불러오는 중입니다.
      </div>
    </section>
  );
}
