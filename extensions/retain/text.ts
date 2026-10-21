const REDACT_PLACEHOLDER = "<REDACTED>";
const CONTINUED_PREFIX = "[continued] ";

const SECRET_PATTERNS: RegExp[] = [
  /(?:api[_-]?key|secret|token|password)\s*[:=]\s*['\"]?([^\s'\"`,;}{]{8,})['\"]?/gi,
  /\bsk-[A-Za-z0-9\-]{20,}\b/g,
  /\bhch-v\d+-[A-Za-z0-9]{20,}\b/g,
  /\bBearer\s+[A-Za-z0-9\-._~+/]{20,}=*/g,
];

export const sanitizeCredentials = (text: string): string => {
  let result = text;
  for (const re of SECRET_PATTERNS) {
    re.lastIndex = 0;
    result = result.replace(re, REDACT_PLACEHOLDER);
  }
  return result;
};

const findChunkBoundary = (search: string, maxLen: number): number => {
  const paragraph = search.lastIndexOf("\n\n");
  if (paragraph > 0) return paragraph + 2;
  const sentence = search.lastIndexOf(". ");
  if (sentence > 0) return sentence + 2;
  const word = search.lastIndexOf(" ");
  if (word > 0) return word + 1;
  return maxLen;
};

export const chunkTextSmart = (text: string, maxLen: number): string[] => {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    const search = remaining.slice(0, maxLen);
    const cut = findChunkBoundary(search, maxLen);
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }
  return chunks.map((chunk, index) => (index === 0 ? chunk : `${CONTINUED_PREFIX}${chunk}`));
};
