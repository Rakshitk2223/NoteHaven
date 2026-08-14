// Secret masking for the snippet viewer.
//
// Pure string functions, deliberately kept out of lib/codeSnippets.ts so they
// carry no dependency on the Supabase client — that made them impossible to
// exercise outside a browser.
//
// Masking used to apply only when language === 'env', so the same API key
// pasted into a yaml/json/plaintext snippet rendered in full.

/**
 * Mask the values in a .env-style document while keeping keys, comments and
 * blank lines visible.
 *   API_KEY=abc123   ->   API_KEY=••••••••
 */
export function maskEnvValues(code: string): string {
  return code
    .split('\n')
    .map((line) => {
      const trimmed = line.trimStart();
      if (!trimmed || trimmed.startsWith('#')) return line;
      const match = line.match(/^(\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_.]*\s*=)(.*)$/);
      if (!match) return line;
      const [, keyPart, value] = match;
      return value.trim().length === 0 ? line : `${keyPart}••••••••`;
    })
    .join('\n');
}

/** Keys whose value should be hidden regardless of the snippet's language. */
const SECRET_KEY_RE = /(api[_-]?key|secret|password|passwd|pwd|token|auth|credential|private[_-]?key|access[_-]?key|client[_-]?secret|bearer|dsn|connection[_-]?string)/i;

/**
 * `key: value`, `key = value`, `"key": "value"` — covers env, yaml, json, ini
 * and most config-ish plaintext without parsing each format properly.
 */
const KEY_VALUE_RE = /^(\s*["']?)([A-Za-z_][\w.-]*)(["']?\s*[:=]\s*)(.+?)(,?\s*)$/;

/** True when a snippet looks like it holds credentials, whatever its language. */
export function looksLikeSecrets(code: string, language: string): boolean {
  if (language === 'env') return true;
  // Cap the scan: a huge file shouldn't stall the render to answer a yes/no.
  for (const line of code.split('\n', 400)) {
    const m = line.match(KEY_VALUE_RE);
    if (m && SECRET_KEY_RE.test(m[2]) && m[4].trim().replace(/["',]/g, '').length > 0) {
      return true;
    }
  }
  return false;
}

/**
 * Mask secret-looking values in any format. For `.env` every value is masked
 * (the whole file is secrets); elsewhere only keys matching SECRET_KEY_RE, so a
 * normal YAML config stays readable.
 */
export function maskSecrets(code: string, language: string): string {
  if (language === 'env') return maskEnvValues(code);

  return code
    .split('\n')
    .map((line) => {
      const trimmed = line.trimStart();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) return line;
      const m = line.match(KEY_VALUE_RE);
      if (!m) return line;
      const [, open, key, sep, value, tail] = m;
      if (!SECRET_KEY_RE.test(key)) return line;
      const bare = value.trim();
      if (!bare || bare === '""' || bare === "''") return line;
      // Preserve surrounding quotes so the file still parses when revealed.
      const quoted = /^["']/.test(bare) ? `${bare[0]}••••••••${bare[0]}` : '••••••••';
      return `${open}${key}${sep}${quoted}${tail}`;
    })
    .join('\n');
}
