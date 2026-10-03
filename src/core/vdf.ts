/**
 * Minimal parser for Valve's text KeyValues format (libraryfolders.vdf, appmanifest_*.acf).
 */
export type VdfValue = string | VdfObject;
export interface VdfObject {
  [key: string]: VdfValue;
}

export function parseVdf(text: string): VdfObject {
  let i = 0;
  const n = text.length;

  const skip = (): void => {
    while (i < n) {
      const c = text[i]!;
      if (c === '/' && text[i + 1] === '/') {
        while (i < n && text[i] !== '\n') i++;
      } else if (/\s/.test(c)) {
        i++;
      } else break;
    }
  };

  const readString = (): string => {
    if (text[i] === '"') {
      i++;
      let out = '';
      while (i < n && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < n) {
          const next = text[i + 1]!;
          out += next === 'n' ? '\n' : next === 't' ? '\t' : next;
          i += 2;
        } else {
          out += text[i++];
        }
      }
      i++;
      return out;
    }
    let out = '';
    while (i < n && !/[\s{}"]/.test(text[i]!)) out += text[i++];
    return out;
  };

  const readObject = (top: boolean): VdfObject => {
    const obj: VdfObject = {};
    for (;;) {
      skip();
      if (i >= n) {
        if (!top) throw new Error('Unexpected end of VDF: missing }');
        return obj;
      }
      if (text[i] === '}') {
        if (top) throw new Error('Unexpected } in VDF');
        i++;
        return obj;
      }
      const key = readString();
      skip();
      if (text[i] === '{') {
        i++;
        obj[key] = readObject(false);
      } else {
        obj[key] = readString();
      }
    }
  };

  return readObject(true);
}

/** Library folder paths from the contents of steamapps/libraryfolders.vdf. */
export function steamLibraryPaths(vdfText: string): string[] {
  const root = parseVdf(vdfText);
  const folders = root['libraryfolders'] ?? root['LibraryFolders'];
  if (!folders || typeof folders === 'string') return [];
  const paths: string[] = [];
  for (const [key, value] of Object.entries(folders)) {
    if (!/^\d+$/.test(key)) continue;
    if (typeof value === 'string') paths.push(value);
    else if (typeof value['path'] === 'string') paths.push(value['path']);
  }
  return paths;
}
