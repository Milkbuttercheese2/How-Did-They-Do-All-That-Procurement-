const ACCENTS = ["#0f9f72", "#3b82f6", "#c78116", "#0891b2"];
const EXTRA_LANE_ORDER = [2, 1, 0, 3];
const TITLE_OVERRIDES = {
  "environmental-impact-assessment": [
    "사업 준비·작성",
    "승인·공고",
    "협의·전문검토",
    "주민·정보공개",
  ],
};

export function buildProcessLaneGroups(lanes, slug) {
  return partitionLanes(lanes).map((groupLanes, index) => ({
    id: `group-${index + 1}`,
    title: TITLE_OVERRIDES[slug]?.[index] ?? summarizeGroupTitle(groupLanes),
    lanes: groupLanes,
    accent: ACCENTS[index],
  }));
}

function partitionLanes(lanes) {
  const groupCount = Math.min(4, lanes.length);
  if (groupCount === 0) return [];

  const baseSize = Math.floor(lanes.length / groupCount);
  const sizes = Array.from({ length: groupCount }, () => baseSize);
  const remainder = lanes.length % groupCount;
  const order = EXTRA_LANE_ORDER.filter((index) => index < groupCount);
  for (let index = 0; index < remainder; index += 1) {
    sizes[order[index] ?? index] += 1;
  }

  let cursor = 0;
  return sizes.map((size) => {
    const group = lanes.slice(cursor, cursor + size);
    cursor += size;
    return group;
  });
}

function summarizeGroupTitle(lanes) {
  if (lanes.length === 1) return truncate(compactLaneLabel(lanes[0]), 18);
  if (lanes.length === 2) {
    return truncate(
      `${compactLaneLabel(lanes[0])}·${compactLaneLabel(lanes[1])}`,
      18
    );
  }
  return `${truncate(compactLaneLabel(lanes[0]), 13)} 외 ${lanes.length - 1}`;
}

function compactLaneLabel(lane) {
  const cleaned = lane
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replaceAll("/", "·")
    .trim();
  if (Array.from(cleaned).length <= 9) return cleaned;
  return cleaned.split("·")[0].trim();
}

function truncate(value, maxLength) {
  const chars = Array.from(value);
  return chars.length <= maxLength
    ? value
    : `${chars.slice(0, maxLength - 1).join("")}…`;
}
