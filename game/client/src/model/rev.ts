// A content hash for models: two 32-bit FNV-1a-style lanes over a canonical JSON, as 16 hex digits. Equal content gives
// equal revs; a collision between different contents is a 2^-64 chance, which the app treats as never (a ChangeSet's
// `seq`, not its rev, orders the queue).

export function hash(text: string): string {
  let a = 0x811c9dc5, b = 0x9747b28c;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
    b ^= b >>> 15;
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  return hex(a) + hex(b);
}
