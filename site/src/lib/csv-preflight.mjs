/**
 * Bounded RFC 4180-style CSV point-coordinate validation for the browser Worker.
 * CSV does not carry a CRS: the product explicitly requires WGS84 longitude/latitude.
 * This is a preflight gate, not an independent GDAL parsing certification.
 */
const ALLOWED_LON = new Set(['longitude', 'lon', 'x']);
const ALLOWED_LAT = new Set(['latitude', 'lat', 'y']);
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_FIELD_CHARS = 262144;
const MAX_COLUMNS = 512;
function reject(reason) { throw new Error('GIS input rejected: CSV ' + reason); }

export function validateCoordinateCsvText(text) {
  if (typeof text !== 'string') reject('input must be UTF-8 text');
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  let field = '', record = [], quoted = false, quoteClosed = false;
  let headers = null, lonColumn = -1, latColumn = -1, dataRows = 0;
  function finishField() {
    record.push(field);
    if (record.length > MAX_COLUMNS) reject('contains too many columns');
    field = '';
    quoteClosed = false;
  }
  function finishRecord() {
    finishField();
    // Skip physically empty lines only. A row with multiple blank CSV fields
    // must not be silently skipped, as GDAL could treat it as a feature.
    if (record.length === 1 && record[0] === '') {
      record = [];
      return;
    }
    if (headers === null) {
      headers = record.map(value => value.trim().toLowerCase());
      if (headers.some(value => value === '')) reject('has empty column headings');
      if (new Set(headers).size !== headers.length) reject('has duplicate column headings');
      const xs = headers.flatMap((value, index) => ALLOWED_LON.has(value) ? [index] : []);
      const ys = headers.flatMap((value, index) => ALLOWED_LAT.has(value) ? [index] : []);
      if (xs.length !== 1 || ys.length !== 1) reject('must have one unambiguous longitude/lon/x and latitude/lat/y column');
      lonColumn = xs[0]; latColumn = ys[0];
    } else {
      const row = dataRows + 2; // Number of logical CSV records, not physical lines.
      if (record.length !== headers.length) reject('row ' + row + ' has an inconsistent column count');
      function readCoordinate(index, label, bound) {
        const raw = record[index].trim();
        if (!DECIMAL.test(raw)) reject('row ' + row + ' has missing or non-decimal ' + label);
        const n = Number(raw);
        if (!Number.isFinite(n) || Math.abs(n) > bound)
          reject('row ' + row + ' has ' + label + ' outside WGS84 bounds');
        return n;
      }
      readCoordinate(lonColumn, 'longitude', 180);
      readCoordinate(latColumn, 'latitude', 90);
      dataRows++;
    }
    record = [];
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i+1] === '"') { field += '"'; i++; }
        else { quoted = false; quoteClosed = true; }
      } else field += char;
    } else if (quoteClosed) {
      if (char === ',') finishField();
      else if (char === '\r' || char === '\n') {
        if (char === '\r' && text[i+1] === '\n') i++;
        finishRecord();
      } else reject('contains characters after a closing quote');
    } else if (char === '"') {
      if (field !== '') reject('has a quote inside an unquoted field');
      quoted = true;
    } else if (char === ',') finishField();
    else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[i+1] === '\n') i++;
      finishRecord();
    } else field += char;
    if (field.length > MAX_FIELD_CHARS) reject('has an oversized field');
  }
  if (quoted) reject('has an unclosed quoted field');
  if (quoteClosed || record.length || field !== '') finishRecord();
  if (headers === null || !dataRows) reject('must contain a header and at least one coordinate row');
  return {rows:dataRows, columns:headers.length, longitudeColumn:lonColumn, latitudeColumn:latColumn};
}

export async function preflightCoordinateCsv(file) {
  if (!(file instanceof Blob) || file.size === 0 || file.size > MAX_FILE_BYTES)
    reject('file empty or exceeds 15 MiB');
  let text;
  try { text = new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer()); }
  catch { reject('must use valid UTF-8 encoding'); }
  if (text.includes('\0')) reject('contains NUL bytes');
  return validateCoordinateCsvText(text);
}
