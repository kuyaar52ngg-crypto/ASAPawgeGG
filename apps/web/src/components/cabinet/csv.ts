/** Parses CSV text and returns the first column of every row (RFC-4180 quotes supported). A header row such as «key» / «ключ» is skipped. */
export function parseCsvFirstColumn(text: string): string[] {
  const rows: string[] = [];
  let cell = "";
  let inQuotes = false;
  let first = true; // the first column of the current row has not been emitted yet
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") inQuotes = true;
    else if (ch === "," || ch === ";" || ch === "\t") {
      if (first) rows.push(cell);
      first = false;
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      if (first) rows.push(cell);
      first = true;
      cell = "";
    } else cell += ch;
  }
  if (first && cell !== "") rows.push(cell);
  const cleaned = rows.map((s) => s.trim()).filter(Boolean);
  if (cleaned.length > 1 && /^(key|keys|code|codes|ключ|ключи|код|коды|serial)$/i.test(cleaned[0]!)) cleaned.shift();
  return cleaned;
}

