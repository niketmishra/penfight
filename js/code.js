// Room codes. Crockford base32 alphabet (no I, L, O, U) so codes survive
// being read off a screen and typed by hand. Same idea as DumbActing's codec.

export const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CODE_LEN = 6;

export function genCode() {
  const bytes = new Uint8Array(CODE_LEN);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b & 31];
  return out;
}

// Forgive the classic misreads: i/l are 1, o is 0. Uppercase, strip junk.
export function canonicalize(input) {
  return (input || "")
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
}

export function isValidCode(code) {
  return code.length === CODE_LEN && [...code].every(c => ALPHABET.includes(c));
}
