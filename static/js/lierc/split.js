// IRC's line limit is in bytes (512, UTF-8), so a message is measured and
// split in bytes, not characters: é is 2 bytes and most emoji are 4.

const encoder = new TextEncoder();

export function byte_length(text) {
  return encoder.encode(text).length;
}

// Splits text into pieces of at most max bytes, at word boundaries where
// it can and between characters (never inside one) where a word alone is
// longer than max.
export function split_bytes(text, max) {
  const pieces = [];
  let buf = "";
  let len = 0;

  const flush = () => {
    if (buf)
      pieces.push(buf);
    buf = "";
    len = 0;
  };

  for (const word of text.split(/(\b)/)) {
    const size = byte_length(word);
    if (len + size <= max) {
      buf += word;
      len += size;
      continue;
    }
    flush();
    if (size <= max) {
      buf = word;
      len = size;
      continue;
    }
    // a word longer than a whole piece: by character (code point)
    for (const char of word) {
      const n = byte_length(char);
      if (len + n > max)
        flush();
      buf += char;
      len += n;
    }
  }
  flush();
  return pieces;
}
