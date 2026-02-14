/**
 * @param {string} text
 * @returns {number[]}
 */
function fallbackEmbedding(text) {
  const chars = [...text];
  if (chars.length === 0) return [0];
  const mean = chars.reduce((sum, char) => sum + char.codePointAt(0), 0) / chars.length;
  return [Number(mean.toFixed(4)), chars.length];
}

/**
 * @param {string} text
 * @param {{ embedText?: (value: string) => Promise<number[]> | number[] }} [options]
 * @returns {Promise<number[]>}
 */
export async function embedText(text, options = {}) {
  if (typeof options.embedText === 'function') {
    return options.embedText(text);
  }
  return fallbackEmbedding(text);
}
