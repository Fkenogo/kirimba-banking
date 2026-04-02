function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (typeof value._seconds === "number") return value._seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function matchesDateRange(value, dateFrom, dateTo) {
  const ms = toMillis(value);
  if (!ms) return false;
  if (dateFrom) {
    const fromMs = new Date(`${dateFrom}T00:00:00`).getTime();
    if (ms < fromMs) return false;
  }
  if (dateTo) {
    const toMs = new Date(`${dateTo}T23:59:59.999`).getTime();
    if (ms > toMs) return false;
  }
  return true;
}

export function buildBatchFilterOptions(rows = []) {
  const agents = [...new Map(
    rows
      .filter((row) => row.agentId || row.agentName)
      .map((row) => [row.agentId || row.agentName, { id: row.agentId || row.agentName, name: row.agentName || row.agentId }])
  ).values()];

  const groups = [...new Map(
    rows
      .filter((row) => row.groupId || row.groupName)
      .map((row) => [row.groupId || row.groupName, { id: row.groupId || row.groupName, name: row.groupName || row.groupId }])
  ).values()];

  return {
    agents: agents.sort((a, b) => a.name.localeCompare(b.name)),
    groups: groups.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function filterBatchRows(rows = [], filters = {}, { dateField = "submittedAt" } = {}) {
  const textQuery = normalizeText(filters.query);
  return rows.filter((row) => {
    if (filters.agentId && (row.agentId || "") !== filters.agentId) return false;
    if (filters.groupId && (row.groupId || "") !== filters.groupId) return false;
    if (!matchesDateRange(row[dateField], filters.dateFrom, filters.dateTo)) return false;
    if (!textQuery) return true;
    const haystack = [
      row.id,
      row.groupName,
      row.groupId,
      row.agentName,
      row.agentId,
      row.institutionRef,
      row.umucoAccountRef,
      row.institutionNotes,
      row.umucoNotes,
    ];
    return haystack.some((value) => normalizeText(value).includes(textQuery));
  });
}
