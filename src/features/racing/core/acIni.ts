/** A plain INI reader for Assetto Corsa's cfg files: sections and keys upper case, `; comment` kept apart. */

export type Ini = Map<string, Map<string, { value: string; comment: string }>>;

export function parseIni(text: string): Ini {
  const ini: Ini = new Map();
  let section: Map<string, { value: string; comment: string }> | undefined;
  for (const line of text.split(/\r?\n/)) {
    const head = /^\s*\[(.+?)\]\s*$/.exec(line);
    if (head) {
      section = new Map();
      ini.set(head[1]!.toUpperCase(), section);
      continue;
    }
    const pair = /^\s*([^=;]+?)\s*=\s*([^;]*?)\s*(?:;\s*(.*))?$/.exec(line);
    if (pair && section)
      section.set(pair[1]!.toUpperCase(), { value: pair[2]!, comment: (pair[3] ?? '').trim() });
  }
  return ini;
}
