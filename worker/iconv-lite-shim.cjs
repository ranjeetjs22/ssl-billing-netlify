/**
 * Minimal `iconv-lite` replacement for the Cloudflare Workers build.
 *
 * Why this exists: iconv-lite@0.4 ends with `require("./streams")(iconv)` - it calls a
 * module as a function. esbuild's CJS/ESM interop turns that into
 * `require_streams(...) is not a function`, so the Worker fails to boot (API error 10021).
 *
 * Express only reaches iconv-lite through body-parser/raw-body, which use exactly three
 * entry points:
 *   - iconv.encodingExists(enc)   -> body-parser, to answer 415 on an unsupported charset
 *   - iconv.decode(buffer, enc)   -> body-parser, to decode a fully buffered body
 *   - iconv.getDecoder(enc)       -> raw-body, an incremental { write(chunk), end() } decoder
 *
 * All three are implemented here on the runtime's native TextDecoder, so no stream shims
 * and no Node-only extensions are needed. Anything this file cannot decode reports as
 * unsupported, which makes body-parser return a correct 415 instead of crashing.
 *
 * Wired up via the `alias` field in wrangler.jsonc - the real iconv-lite is still used
 * when running under Node (npm run dev).
 */

/** Normalise an encoding label to something TextDecoder understands. */
function normalise(enc) {
  const raw = String(enc == null ? 'utf-8' : enc).toLowerCase().trim();
  const key = raw.replace(/[^a-z0-9]/g, '');
  switch (key) {
    case '':
    case 'utf8':
    case 'utf':
    case 'unicode11utf8':
      return 'utf-8';
    case 'ascii':
    case 'usascii':
    case 'latin1':
    case 'binary':
    case 'iso88591':
    case 'cp1252':
    case 'windows1252':
      return 'latin1';
    case 'utf16le':
    case 'ucs2':
    case 'utf16':
      return 'utf-16le';
    default:
      return raw;
  }
}

/** latin1 is a straight byte -> code point map; do it directly so it never depends on
 *  which encodings the host's TextDecoder happens to ship with. */
function decodeLatin1(bytes) {
  let out = '';
  const CHUNK = 0x8000; // avoid blowing the argument limit on large bodies
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return out;
}

function toBytes(buf) {
  if (buf == null) return new Uint8Array(0);
  if (buf instanceof Uint8Array) return buf;
  if (ArrayBuffer.isView(buf)) return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf instanceof ArrayBuffer) return new Uint8Array(buf);
  return new Uint8Array(buf);
}

function makeDecoder(enc) {
  const label = normalise(enc);
  if (label === 'latin1') {
    return {
      write: (chunk) => decodeLatin1(toBytes(chunk)),
      end: () => '',
    };
  }
  // Throws for an unknown label - callers translate that into "unsupported charset".
  const td = new TextDecoder(label);
  return {
    write: (chunk) => td.decode(toBytes(chunk), { stream: true }),
    end: () => td.decode(),
  };
}

function encodingExists(enc) {
  try {
    makeDecoder(enc);
    return true;
  } catch {
    return false;
  }
}

function decode(buf, enc) {
  const bytes = toBytes(buf);
  const label = normalise(enc);
  if (label === 'latin1') return decodeLatin1(bytes);
  return new TextDecoder(label).decode(bytes);
}

function encode(str, enc) {
  const label = normalise(enc);
  if (label === 'utf-8') return new TextEncoder().encode(String(str));
  // Only UTF-8 output is ever needed by this app; fall back to it rather than
  // silently producing wrong bytes for an exotic label.
  return new TextEncoder().encode(String(str));
}

function getDecoder(enc) {
  return makeDecoder(enc);
}

function getEncoder() {
  return {
    write: (str) => encode(str),
    end: () => new Uint8Array(0),
  };
}

module.exports = {
  encodingExists,
  decode,
  encode,
  getDecoder,
  getEncoder,
  // iconv-lite exposes these; keep them so any stray access does not throw.
  defaultCharUnicode: '�',
  defaultCharSingleByte: '?',
  supportsStreams: false,
  encodings: null,
  skipDecodeWarning: true,
};
