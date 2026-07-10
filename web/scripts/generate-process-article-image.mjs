import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { buildProcessLaneGroups } from "../src/lib/process-layout.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..");
const dataDir = path.join(webRoot, "data/institutions");
const outputDir = path.join(webRoot, "public/exports/process-maps");
const legacyEiaPath = path.join(
  webRoot,
  "public/exports/environmental-impact-assessment-process-map.png"
);

const WIDTH = 1800;
const HEIGHT = 2400;
const GRID_LEFT = 38;
const GRID_RIGHT = 1762;
const GRID_TOP = 260;
const GROUP_HEADER_HEIGHT = 100;
const STAGE_LABEL_WIDTH = 190;
const GROUP_X = GRID_LEFT + STAGE_LABEL_WIDTH;
const GRID_BOTTOM = 2200;
const STAGE_BODY_TOP = GRID_TOP + GROUP_HEADER_HEIGHT;
const STAGE_BODY_HEIGHT = GRID_BOTTOM - STAGE_BODY_TOP;
const CARD_WIDTH = 270;
const CARD_HEIGHT = 80;
const CARD_GAP = 24;
const STAGE_VERTICAL_SPACE = 52;
const MIN_STAGE_HEIGHT = 126;
const ARROW_CLEARANCE = 8;

const STATUS = {
  done: {
    label: "선행",
    fill: "#effaf5",
    border: "#35a77d",
    ink: "#123d2e",
    sub: "#287a5c",
  },
  current: {
    label: "핵심",
    fill: "#087452",
    border: "#087452",
    ink: "#ffffff",
    sub: "#d8f4e8",
  },
  waiting: {
    label: "후속",
    fill: "#ffffff",
    border: "#b9c7bf",
    ink: "#17231d",
    sub: "#627169",
  },
  risk: {
    label: "병목",
    fill: "#fff8e8",
    border: "#d9901a",
    ink: "#7a4305",
    sub: "#a96008",
  },
  loop: {
    label: "회귀",
    fill: "#edf4ff",
    border: "#3478db",
    ink: "#173f7a",
    sub: "#316bbd",
  },
};

const files = (await fs.readdir(dataDir))
  .filter((file) => file.endsWith(".json"))
  .sort();

await fs.mkdir(outputDir, { recursive: true });
const generated = [];
for (let index = 0; index < files.length; index += 4) {
  const batch = files.slice(index, index + 4);
  const results = await Promise.all(batch.map(generateInstitutionImage));
  generated.push(...results);
}

if (generated.length !== 100) {
  throw new Error(`세로형 PNG는 100개여야 합니다: ${generated.length}`);
}

const eiaOutput = path.join(outputDir, "environmental-impact-assessment.png");
await fs.copyFile(eiaOutput, legacyEiaPath);
console.log(`세로형 업무구조도 PNG 생성: ${generated.length}개 (${WIDTH}x${HEIGHT})`);

async function generateInstitutionImage(file) {
  const institution = JSON.parse(await fs.readFile(path.join(dataDir, file), "utf8"));
  const process = institution.process;
  const groups = buildProcessLaneGroups(process?.lanes ?? [], institution.slug);
  if (!process || !groups?.length) {
    throw new Error(`프로세스 또는 레이아웃 설정 누락: ${institution.slug}`);
  }

  const context = buildLayout(institution, process, groups);
  const outputPath = path.join(outputDir, `${institution.slug}.png`);
  const svg = renderSvg(context);
  await sharp(Buffer.from(svg), { density: 144 })
    .resize(WIDTH, HEIGHT)
    .png({ compressionLevel: 9, quality: 100 })
    .toFile(outputPath);

  const metadata = await sharp(outputPath).metadata();
  if (metadata.width !== WIDTH || metadata.height !== HEIGHT) {
    throw new Error(`PNG 규격 오류: ${institution.slug}`);
  }
  return outputPath;
}

function buildLayout(institution, process, groups) {
  const groupWidth = (GRID_RIGHT - GROUP_X) / groups.length;
  const stageIndex = new Map(process.stages.map((stage, index) => [stage, index]));
  const groupByLane = new Map(
    groups.flatMap((group, groupIndex) =>
      group.lanes.map((lane) => [lane, groupIndex])
    )
  );
  const nodesByCell = new Map();

  for (const node of process.nodes) {
    const rowIndex = stageIndex.get(node.stage);
    const groupIndex = groupByLane.get(node.lane);
    if (rowIndex === undefined || groupIndex === undefined) {
      throw new Error(`노드 배치 설정 누락: ${institution.slug}/${node.id}`);
    }
    const key = `${rowIndex}:${groupIndex}`;
    const cell = nodesByCell.get(key) ?? [];
    cell.push(node);
    nodesByCell.set(key, cell);
  }

  const maxCellCounts = process.stages.map((_, rowIndex) =>
    Math.max(
      1,
      ...groups.map(
        (_, groupIndex) => nodesByCell.get(`${rowIndex}:${groupIndex}`)?.length ?? 0
      )
    )
  );
  const desiredStageHeights = maxCellCounts.map((count) =>
    Math.max(
      MIN_STAGE_HEIGHT,
      count * CARD_HEIGHT + (count - 1) * CARD_GAP + STAGE_VERTICAL_SPACE
    )
  );
  const desiredTotal = desiredStageHeights.reduce((sum, height) => sum + height, 0);
  if (desiredTotal > STAGE_BODY_HEIGHT) {
    throw new Error(
      `세로형 캔버스 높이 초과: ${institution.slug} (${desiredTotal}/${STAGE_BODY_HEIGHT})`
    );
  }
  const extraPerStage = (STAGE_BODY_HEIGHT - desiredTotal) / process.stages.length;
  const stageHeights = desiredStageHeights.map((height) => height + extraPerStage);
  const stageTops = [];
  let currentY = STAGE_BODY_TOP;
  for (const stageHeight of stageHeights) {
    stageTops.push(currentY);
    currentY += stageHeight;
  }

  const nodeLayout = new Map();
  for (const [key, cellNodes] of nodesByCell) {
    const [rowIndex, groupIndex] = key.split(":").map(Number);
    const stackHeight =
      cellNodes.length * CARD_HEIGHT + (cellNodes.length - 1) * CARD_GAP;
    const firstY = stageTops[rowIndex] + (stageHeights[rowIndex] - stackHeight) / 2;
    const x =
      GROUP_X +
      groupIndex * groupWidth +
      (groupWidth - CARD_WIDTH) / 2;
    cellNodes.forEach((node, nodeIndex) => {
      nodeLayout.set(node.id, {
        x,
        y: firstY + nodeIndex * (CARD_HEIGHT + CARD_GAP),
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        stageIndex: rowIndex,
        groupIndex,
      });
    });
  }

  if (nodeLayout.size !== process.nodes.length) {
    throw new Error(`노드 배치 수 오류: ${institution.slug}`);
  }

  return {
    institution,
    process,
    groups,
    groupWidth,
    groupByLane,
    stageIndex,
    stageHeights,
    stageTops,
    nodeLayout,
  };
}

function renderSvg(context) {
  const { process } = context;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">`,
    `<defs>
      <filter id="card-shadow" x="-20%" y="-25%" width="140%" height="160%">
        <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#12271e" flood-opacity="0.10"/>
      </filter>
      ${arrowMarker("arrow-sequence", "#53675d")}
      ${arrowMarker("arrow-message", "#0f8a65")}
      ${arrowMarker("arrow-loop", "#3478db")}
      <style>
        text { font-family: "Apple SD Gothic Neo", "Noto Sans CJK KR", "Noto Sans KR", sans-serif; }
        .mono { font-family: "SFMono-Regular", "Menlo", monospace; }
      </style>
    </defs>`,
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="#f6f9f7"/>`,
    `<rect x="0" y="0" width="${WIDTH}" height="14" fill="#087452"/>`,
    renderHeader(context),
    renderGrid(context),
    renderEdges(context),
    ...process.nodes.map((node) => renderNode(node, context)),
    renderFooter(context),
    `</svg>`,
  ].join("\n");
}

function arrowMarker(id, color) {
  return `<marker id="${id}" markerWidth="17" markerHeight="13" refX="15" refY="6.5" orient="auto" markerUnits="userSpaceOnUse">
    <path d="M1,1 L16,6.5 L1,12 Z" fill="${color}" stroke="#ffffff" stroke-width="1.3" stroke-linejoin="round"/>
  </marker>`;
}

function renderHeader({ institution, process }) {
  const titleSize = Array.from(institution.name).length > 20 ? 43 : 52;
  const oneLiner = truncate(institution.oneLiner ?? institution.canvas?.purpose ?? "", 82);
  return `
    <text x="40" y="50" font-size="19" font-weight="750" fill="#087452">대한민국 제도 100 · 법령 기준 업무구조도</text>
    <text x="40" y="108" font-size="${titleSize}" font-weight="800" fill="#111b16">${escapeXml(institution.name)}</text>
    <text x="40" y="154" font-size="21" font-weight="520" fill="#526159">${escapeXml(oneLiner)}</text>
    <text x="40" y="205" font-size="17" font-weight="750" fill="#18251e">${process.nodes.length}개 업무 · ${process.stages.length}단계 · ${process.lanes.length}개 행위자</text>
    <text x="520" y="205" font-size="16" fill="#67766e">법령 기준일 ${escapeXml(institution.asOfDate)}</text>
    <text x="1760" y="205" text-anchor="end" font-size="16" font-weight="700" fill="#a65f08">핵심 병목: ${escapeXml(truncate((institution.canvas?.bottlenecks ?? []).slice(0, 3).join(" · ") || "제도별 병목 노드 확인", 52))}</text>
    <line x1="40" y1="232" x2="1760" y2="232" stroke="#becbc4" stroke-width="2"/>
  `;
}

function renderGrid(context) {
  const { groups, process, groupWidth, stageHeights, stageTops } = context;
  const result = [
    `<rect x="${GRID_LEFT}" y="${GRID_TOP}" width="${GRID_RIGHT - GRID_LEFT}" height="${GRID_BOTTOM - GRID_TOP}" rx="10" fill="#ffffff" stroke="#b8c7bf" stroke-width="2"/>`,
    `<rect x="${GRID_LEFT}" y="${GRID_TOP}" width="${STAGE_LABEL_WIDTH}" height="${GROUP_HEADER_HEIGHT}" rx="10" fill="#eaf2ee"/>`,
    `<text x="58" y="299" font-size="17" font-weight="800" fill="#17231d">단계 ↓</text>`,
    `<text x="58" y="332" font-size="15" font-weight="650" fill="#68776f">행위자 묶음 →</text>`,
  ];

  process.stages.forEach((stage, rowIndex) => {
    const y = stageTops[rowIndex];
    const height = stageHeights[rowIndex];
    const stageNodes = process.nodes.filter((node) => node.stage === stage);
    const hasCurrent = stageNodes.some((node) => node.status === "current");
    const allDone = stageNodes.every((node) => node.status === "done");
    const rowFill = hasCurrent
      ? "#f0faf5"
      : rowIndex % 2 === 0
        ? "#fbfcfb"
        : "#f5f8f6";
    const labelFill = hasCurrent
      ? "#087452"
      : allDone
        ? "#e4f5ed"
        : "#eef3f0";
    const labelInk = hasCurrent ? "#ffffff" : allDone ? "#087452" : "#53645b";
    const [code, ...labelParts] = stage.split(" ");
    result.push(
      `<rect x="${GRID_LEFT}" y="${round(y)}" width="${GRID_RIGHT - GRID_LEFT}" height="${round(height)}" fill="${rowFill}"/>`,
      `<rect x="${GRID_LEFT}" y="${round(y)}" width="${STAGE_LABEL_WIDTH}" height="${round(height)}" fill="${labelFill}"/>`,
      `<text x="58" y="${round(y + 32)}" class="mono" font-size="16" font-weight="800" fill="${labelInk}">${escapeXml(code)}</text>`,
      textLines(wrapText(labelParts.join(" "), 8, 2), 58, y + 65, {
        size: 19,
        weight: 800,
        fill: labelInk,
        lineHeight: 22,
      })
    );
  });

  groups.forEach((group, groupIndex) => {
    const x = GROUP_X + groupIndex * groupWidth;
    result.push(
      `<rect x="${round(x)}" y="${GRID_TOP}" width="${round(groupWidth)}" height="${GROUP_HEADER_HEIGHT}" fill="#f7faf8"/>`,
      `<rect x="${round(x)}" y="${GRID_TOP}" width="${round(groupWidth)}" height="7" fill="${group.accent}"/>`,
      `<text x="${round(x + 20)}" y="299" font-size="21" font-weight="800" fill="#17231d">${escapeXml(truncate(group.title, 18))}</text>`,
      textLines(wrapText(group.lanes.join(" · "), 25, 2), x + 20, 329, {
        size: 13.5,
        weight: 600,
        fill: "#68776f",
        lineHeight: 19,
      })
    );
  });

  for (let index = 0; index <= groups.length; index += 1) {
    const x = GROUP_X + index * groupWidth;
    result.push(
      `<line x1="${round(x)}" y1="${GRID_TOP}" x2="${round(x)}" y2="${GRID_BOTTOM}" stroke="#d3dcd7" stroke-width="1.5"/>`
    );
  }
  result.push(
    `<line x1="${GRID_LEFT}" y1="${STAGE_BODY_TOP}" x2="${GRID_RIGHT}" y2="${STAGE_BODY_TOP}" stroke="#b8c7bf" stroke-width="2"/>`
  );
  stageTops.forEach((y) => {
    result.push(
      `<line x1="${GRID_LEFT}" y1="${round(y)}" x2="${GRID_RIGHT}" y2="${round(y)}" stroke="#c8d3cd" stroke-width="1.5"/>`
    );
  });
  result.push(
    `<line x1="${GRID_LEFT}" y1="${GRID_BOTTOM}" x2="${GRID_RIGHT}" y2="${GRID_BOTTOM}" stroke="#b8c7bf" stroke-width="2"/>`
  );
  return result.join("\n");
}

function renderEdges(context) {
  const result = [];
  for (const edge of context.process.edges) {
    const source = context.nodeLayout.get(edge.source);
    const target = context.nodeLayout.get(edge.target);
    if (!source || !target) {
      throw new Error(`연결 배치 누락: ${context.institution.slug}/${edge.id}`);
    }
    const style =
      edge.type === "loop"
        ? { color: "#3478db", width: 4, dash: "10 8", marker: "arrow-loop" }
        : edge.type === "message"
          ? { color: "#0f8a65", width: 3.4, dash: "11 8", marker: "arrow-message" }
          : { color: "#53675d", width: 3.4, dash: "", marker: "arrow-sequence" };
    const route = edgeRoute(edge, source, target, context);
    result.push(
      `<path d="${route.path}" fill="none" stroke="${style.color}" stroke-width="${style.width}" ${style.dash ? `stroke-dasharray="${style.dash}"` : ""} marker-end="url(#${style.marker})" stroke-linecap="round" stroke-linejoin="round" opacity="0.96"/>`
    );
    if (edge.label) {
      const labelWidth = Math.max(96, Array.from(edge.label).length * 14 + 26);
      result.push(
        `<rect x="${round(route.labelX - labelWidth / 2)}" y="${round(route.labelY - 15)}" width="${labelWidth}" height="30" rx="6" fill="#ffffff" stroke="${style.color}" stroke-width="1.4"/>`,
        `<text x="${round(route.labelX)}" y="${round(route.labelY + 5)}" text-anchor="middle" font-size="14" font-weight="750" fill="${style.color}">${escapeXml(edge.label)}</text>`
      );
    }
  }
  return result.join("\n");
}

function edgeRoute(edge, source, target, context) {
  const sourceCenterX = source.x + source.width / 2;
  const sourceCenterY = source.y + source.height / 2;
  const targetCenterX = target.x + target.width / 2;
  const targetCenterY = target.y + target.height / 2;
  const sourceRight = source.x + source.width;
  const targetRight = target.x + target.width;
  const sourceBottom = source.y + source.height;
  const targetBottom = target.y + target.height;
  const messageOffset = edge.type === "message" ? 20 : 0;

  if (source.stageIndex === target.stageIndex && source.groupIndex === target.groupIndex) {
    if (edge.type === "message") {
      const sideX = sourceRight + 28;
      return {
        path: `M ${round(sourceRight)} ${round(sourceCenterY)} H ${round(sideX)} V ${round(targetCenterY)} H ${round(targetRight + ARROW_CLEARANCE)}`,
        labelX: sideX + 58,
        labelY: (sourceCenterY + targetCenterY) / 2,
      };
    }
    const downward = target.y >= sourceBottom;
    return {
      path: downward
        ? `M ${round(sourceCenterX)} ${round(sourceBottom)} V ${round(target.y - ARROW_CLEARANCE)}`
        : `M ${round(source.x)} ${round(sourceCenterY)} H ${round(GROUP_X - 12)} V ${round(targetCenterY)} H ${round(target.x - ARROW_CLEARANCE)}`,
      labelX: downward ? sourceRight + 50 : GROUP_X + 48,
      labelY: (sourceCenterY + targetCenterY) / 2,
    };
  }

  if (source.stageIndex === target.stageIndex) {
    const rowBottom =
      context.stageTops[source.stageIndex] + context.stageHeights[source.stageIndex];
    const channelY = rowBottom - 12 - (edge.type === "message" ? 10 : 0);
    return {
      path: `M ${round(sourceCenterX + messageOffset)} ${round(sourceBottom)} V ${round(channelY)} H ${round(targetCenterX + messageOffset)} V ${round(targetBottom + ARROW_CLEARANCE)}`,
      labelX: (sourceCenterX + targetCenterX) / 2,
      labelY: channelY - 17,
    };
  }

  if (target.stageIndex > source.stageIndex) {
    const sourceRowBottom =
      context.stageTops[source.stageIndex] + context.stageHeights[source.stageIndex];
    const channelY = sourceRowBottom - 12 - (edge.type === "message" ? 10 : 0);
    return {
      path: `M ${round(sourceCenterX + messageOffset)} ${round(sourceBottom)} V ${round(channelY)} H ${round(targetCenterX + messageOffset)} V ${round(target.y - ARROW_CLEARANCE)}`,
      labelX: (sourceCenterX + targetCenterX) / 2,
      labelY: channelY - 17,
    };
  }

  const railX = GROUP_X - 12;
  const targetRowBottom =
    context.stageTops[target.stageIndex] + context.stageHeights[target.stageIndex];
  const channelY = targetRowBottom - 20;
  return {
    path: `M ${round(source.x)} ${round(sourceCenterY)} H ${round(railX)} V ${round(channelY)} H ${round(targetCenterX)} V ${round(targetBottom + ARROW_CLEARANCE)}`,
    labelX: railX + 70,
    labelY: (sourceCenterY + channelY) / 2,
  };
}

function renderNode(node, context) {
  const position = context.nodeLayout.get(node.id);
  const status = STATUS[node.status] ?? STATUS.waiting;
  const x = position.x;
  const y = position.y;
  const statusWidth = 50;
  const nameLines = wrapText(node.name, 12, 2);
  const footer = node.blocker ? `⚠ ${node.blocker}` : node.actor;
  const footerColor = node.blocker
    ? node.status === "current"
      ? "#fff0bc"
      : "#a96008"
    : status.sub;
  const idPrefix = node.type === "gateway" ? "◇ " : node.type === "system" ? "▣ " : "";
  return `
    <g filter="url(#card-shadow)">
      <rect x="${round(x)}" y="${round(y)}" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="8" fill="${status.fill}" stroke="${status.border}" stroke-width="2.3"/>
      <rect x="${round(x)}" y="${round(y)}" width="6" height="${CARD_HEIGHT}" rx="3" fill="${status.border}"/>
      <text x="${round(x + 15)}" y="${round(y + 20)}" class="mono" font-size="13.5" font-weight="750" fill="${status.sub}">${idPrefix}${escapeXml(node.id)}</text>
      <rect x="${round(x + CARD_WIDTH - statusWidth - 10)}" y="${round(y + 8)}" width="${statusWidth}" height="24" rx="5" fill="${node.status === "current" ? "#ffffff" : status.border}" opacity="${node.status === "current" ? 0.18 : 0.14}"/>
      <text x="${round(x + CARD_WIDTH - statusWidth / 2 - 10)}" y="${round(y + 25)}" text-anchor="middle" font-size="13" font-weight="800" fill="${status.ink}">${status.label}</text>
      ${textLines(nameLines, x + 15, y + 43, {
        size: 17.5,
        weight: 800,
        fill: status.ink,
        lineHeight: 18.5,
      })}
      <text x="${round(x + 15)}" y="${round(y + 72)}" font-size="12.5" font-weight="650" fill="${footerColor}">${escapeXml(truncate(footer, 20))}</text>
    </g>
  `;
}

function renderFooter({ process, groups }) {
  const legendY = 2245;
  return `
    <text x="38" y="${legendY}" font-size="16" font-weight="800" fill="#18251e">읽는 법</text>
    ${legendStatus(118, legendY - 14, "#35a77d", "선행")}
    ${legendStatus(216, legendY - 14, "#087452", "핵심")}
    ${legendStatus(314, legendY - 14, "#d9901a", "병목")}
    ${legendStatus(412, legendY - 14, "#3478db", "회귀")}
    <line x1="548" y1="${legendY - 8}" x2="600" y2="${legendY - 8}" stroke="#53675d" stroke-width="4" marker-end="url(#arrow-sequence)"/>
    <text x="620" y="${legendY - 2}" font-size="15" fill="#526159">절차 순서</text>
    <line x1="760" y1="${legendY - 8}" x2="812" y2="${legendY - 8}" stroke="#0f8a65" stroke-width="4" stroke-dasharray="10 8" marker-end="url(#arrow-message)"/>
    <text x="832" y="${legendY - 2}" font-size="15" fill="#526159">정보 전달</text>
    <line x1="972" y1="${legendY - 8}" x2="1024" y2="${legendY - 8}" stroke="#3478db" stroke-width="4" stroke-dasharray="10 8" marker-end="url(#arrow-loop)"/>
    <text x="1044" y="${legendY - 2}" font-size="15" fill="#526159">보완 회귀</text>
    <text x="38" y="2291" font-size="15.5" font-weight="650" fill="#56655d">단계는 위→아래, 행위자 묶음은 좌→우로 읽습니다.</text>
    <text x="38" y="2321" font-size="14.5" fill="#68776f">원래 ${process.lanes.length}개 행위자 레인을 ${groups.length}개 레이아웃 묶음으로 배치했으며, ${process.nodes.length}개 업무와 ${process.edges.length}개 연결 관계는 유지했습니다.</text>
    <text x="38" y="2361" font-size="13.5" fill="#7b8881">출처: 해당 제도의 법률·시행령·시행규칙 기반 모델 · 실제 사건의 진행 상태나 법률 자문을 의미하지 않습니다.</text>
    <text x="1762" y="2361" text-anchor="end" font-size="17" font-weight="750" fill="#087452">korea100 · 대한민국 제도 100</text>
  `;
}

function legendStatus(x, y, color, label) {
  return `<rect x="${x}" y="${y - 12}" width="17" height="17" rx="4" fill="${color}"/><text x="${x + 26}" y="${y + 2}" font-size="14.5" fill="#526159">${label}</text>`;
}

function textLines(lines, x, y, options = {}) {
  const {
    size = 18,
    weight = 600,
    fill = "#17231d",
    lineHeight = size * 1.25,
  } = options;
  const tspans = lines
    .map(
      (line, index) =>
        `<tspan x="${round(x)}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`
    )
    .join("");
  return `<text x="${round(x)}" y="${round(y)}" font-size="${size}" font-weight="${weight}" fill="${fill}">${tspans}</text>`;
}

function wrapText(text, maxChars, maxLines) {
  if (Array.from(text).length <= maxChars) return [text];
  const words = text.split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (Array.from(candidate).length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    if (Array.from(word).length > maxChars) {
      const chars = Array.from(word);
      lines.push(chars.slice(0, maxChars).join(""));
      current = chars.slice(maxChars).join("");
    } else {
      current = word;
    }
  }
  if (current) lines.push(current);
  const limited = lines.slice(0, maxLines);
  if (lines.length > maxLines) {
    limited[maxLines - 1] = `${Array.from(limited[maxLines - 1]).slice(0, maxChars - 1).join("")}…`;
  }
  return limited;
}

function truncate(text, maxChars) {
  const chars = Array.from(String(text));
  return chars.length <= maxChars
    ? String(text)
    : `${chars.slice(0, maxChars - 1).join("")}…`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function round(value) {
  return Math.round(value * 10) / 10;
}
