// Same matching as piwin's marketplace search (every token must match; name
// and id outrank keywords, which outrank the description).

export function latestInstallable(entry) {
  return entry.versions.find((version) => !version.yanked);
}

export function searchEntries(extensions, query) {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const listed = extensions.filter((entry) => latestInstallable(entry));
  if (tokens.length === 0) return [...listed].sort((left, right) => left.id.localeCompare(right.id));
  return listed
    .map((entry) => ({ entry, score: score(entry, tokens) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.entry.id.localeCompare(right.entry.id))
    .map((item) => item.entry);
}

function score(entry, tokens) {
  const name = entry.name.toLowerCase();
  const keywords = (entry.keywords ?? []).map((keyword) => keyword.toLowerCase());
  const description = (entry.description ?? '').toLowerCase();
  let total = 0;
  for (const token of tokens) {
    let value = 0;
    if (name === token || entry.id.endsWith(`/${token}`)) value = 8;
    else if (name.includes(token) || entry.id.includes(token)) value = 4;
    else if (keywords.some((keyword) => keyword.includes(token))) value = 2;
    else if (description.includes(token)) value = 1;
    if (value === 0) return 0;
    total += value;
  }
  return total;
}
