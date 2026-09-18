/** Binary protobuf codec for OTLP HTTP logs. Unknown fields are skipped. */
type ObjectValue = Record<string, unknown>;
const MAX_DEPTH = 32;
function object(value: unknown): value is ObjectValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
class Reader {
  constructor(private readonly buf: Uint8Array, private pos = 0, private readonly end = buf.length, private readonly depth = 0) {
    if (depth > MAX_DEPTH) throw new Error('Invalid OTLP protobuf');
  }
  get done() { return this.pos >= this.end; }
  private fail(): never { throw new Error('Invalid OTLP protobuf'); }
  varint(): bigint {
    let result = 0n, shift = 0n;
    for (let i = 0; i < 10; i++) {
      if (this.pos >= this.end) this.fail();
      const b = this.buf[this.pos++]!;
      result |= BigInt(b & 0x7f) << shift;
      if ((b & 0x80) === 0) return result;
      shift += 7n;
    }
    this.fail();
  }
  varintU32(): number {
    const v = this.varint();
    if (v < 0n || v > 0xffffffffn) this.fail();
    return Number(v);
  }
  tag(): [field: number, wire: number] {
    const v = this.varintU32();
    const field = v >>> 3, wire = v & 7;
    if (field === 0 || wire === 3 || wire === 4 || wire === 6 || wire === 7) this.fail();
    return [field, wire];
  }
  bytes(): Uint8Array {
    const len = this.varintU32();
    if (this.pos + len > this.end) this.fail();
    const slice = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return slice;
  }
  string(): string { return Buffer.from(this.bytes()).toString('utf8'); }
  bool(): boolean { return this.varint() !== 0n; }
  int64String(): string {
    const v = this.varint();
    return (v > 0x7fffffffffffffffn ? v - 0x10000000000000000n : v).toString();
  }
  private view(size: number): DataView {
    if (this.pos + size > this.end) this.fail();
    const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, size);
    this.pos += size;
    return view;
  }
  double(): number { return this.view(8).getFloat64(0, true); }
  fixed32(): number { return this.view(4).getUint32(0, true); }
  fixed64String(): string {
    const view = this.view(8);
    return ((BigInt(view.getUint32(4, true)) << 32n) | BigInt(view.getUint32(0, true))).toString();
  }
  skip(wire: number): void {
    if (wire === 0) this.varint();
    else if (wire === 1) this.view(8);
    else if (wire === 2) this.bytes();
    else if (wire === 5) this.view(4);
    else this.fail();
  }
  message<T>(fn: (r: Reader) => T): T {
    const bytes = this.bytes();
    return fn(new Reader(bytes, 0, bytes.length, this.depth + 1));
  }
}
function hex(bytes: Uint8Array): string { return Buffer.from(bytes).toString('hex'); }
function read(reader: Reader, field: (id: number, wire: number, r: Reader) => void): void {
  while (!reader.done) {
    const [id, wire] = reader.tag();
    field(id, wire, reader);
  }
}
function decodeAnyValue(reader: Reader): ObjectValue {
  const value: ObjectValue = {};
  read(reader, (id, wire, r) => {
    if (id === 1 && wire === 2) value.stringValue = r.string();
    else if (id === 2 && wire === 0) value.boolValue = r.bool();
    else if (id === 3 && wire === 0) value.intValue = r.int64String();
    else if (id === 4 && wire === 1) value.doubleValue = r.double();
    else if (id === 5 && wire === 2) value.arrayValue = r.message(decodeArrayValue);
    else if (id === 6 && wire === 2) value.kvlistValue = r.message(decodeKvList);
    else if (id === 7 && wire === 2) value.bytesValue = Buffer.from(r.bytes()).toString('base64');
    else r.skip(wire);
  });
  return value;
}
function decodeArrayValue(reader: Reader): ObjectValue {
  const values: ObjectValue[] = [];
  read(reader, (id, wire, r) => { if (id === 1 && wire === 2) values.push(r.message(decodeAnyValue)); else r.skip(wire); });
  return { values };
}
function decodeKvList(reader: Reader): ObjectValue {
  const values: ObjectValue[] = [];
  read(reader, (id, wire, r) => { if (id === 1 && wire === 2) values.push(r.message(decodeKeyValue)); else r.skip(wire); });
  return { values };
}
function decodeKeyValue(reader: Reader): ObjectValue {
  const item: ObjectValue = {};
  read(reader, (id, wire, r) => {
    if (id === 1 && wire === 2) item.key = r.string();
    else if (id === 2 && wire === 2) item.value = r.message(decodeAnyValue);
    else r.skip(wire);
  });
  return item;
}
function decodeScope(reader: Reader): ObjectValue {
  const scope: ObjectValue = {};
  const attributes: ObjectValue[] = [];
  read(reader, (id, wire, r) => {
    if (id === 1 && wire === 2) scope.name = r.string();
    else if (id === 2 && wire === 2) scope.version = r.string();
    else if (id === 3 && wire === 2) attributes.push(r.message(decodeKeyValue));
    else if (id === 4 && wire === 0) scope.droppedAttributesCount = r.varintU32();
    else r.skip(wire);
  });
  if (attributes.length) scope.attributes = attributes;
  return scope;
}
function decodeResource(reader: Reader): ObjectValue {
  const resource: ObjectValue = {};
  const attributes: ObjectValue[] = [];
  read(reader, (id, wire, r) => {
    if (id === 1 && wire === 2) attributes.push(r.message(decodeKeyValue));
    else if (id === 2 && wire === 0) resource.droppedAttributesCount = r.varintU32();
    else r.skip(wire);
  });
  if (attributes.length) resource.attributes = attributes;
  return resource;
}
function decodeLogRecord(reader: Reader): ObjectValue {
  const record: ObjectValue = {};
  const attributes: ObjectValue[] = [];
  read(reader, (id, wire, r) => {
    if (id === 1 && wire === 1) record.timeUnixNano = r.fixed64String();
    else if (id === 2 && wire === 0) record.severityNumber = r.varintU32();
    else if (id === 3 && wire === 2) record.severityText = r.string();
    else if (id === 5 && wire === 2) record.body = r.message(decodeAnyValue);
    else if (id === 6 && wire === 2) attributes.push(r.message(decodeKeyValue));
    else if (id === 7 && wire === 0) record.droppedAttributesCount = r.varintU32();
    else if (id === 8 && wire === 5) record.flags = r.fixed32();
    else if (id === 9 && wire === 2) record.traceId = hex(r.bytes());
    else if (id === 10 && wire === 2) record.spanId = hex(r.bytes());
    else if (id === 11 && wire === 1) record.observedTimeUnixNano = r.fixed64String();
    else if (id === 12 && wire === 2) record.eventName = r.string();
    else r.skip(wire);
  });
  if (attributes.length) record.attributes = attributes;
  return record;
}
function decodeScopeLogs(reader: Reader): ObjectValue {
  const scopeLogs: ObjectValue = {};
  const logRecords: ObjectValue[] = [];
  read(reader, (id, wire, r) => {
    if (id === 1 && wire === 2) scopeLogs.scope = r.message(decodeScope);
    else if (id === 2 && wire === 2) logRecords.push(r.message(decodeLogRecord));
    else if (id === 3 && wire === 2) scopeLogs.schemaUrl = r.string();
    else r.skip(wire);
  });
  if (logRecords.length) scopeLogs.logRecords = logRecords;
  return scopeLogs;
}
function decodeResourceLogs(reader: Reader): ObjectValue {
  const resourceLogs: ObjectValue = {};
  const scopeLogs: ObjectValue[] = [];
  read(reader, (id, wire, r) => {
    if (id === 1 && wire === 2) resourceLogs.resource = r.message(decodeResource);
    else if (id === 2 && wire === 2) scopeLogs.push(r.message(decodeScopeLogs));
    else if (id === 3 && wire === 2) resourceLogs.schemaUrl = r.string();
    else r.skip(wire);
  });
  if (scopeLogs.length) resourceLogs.scopeLogs = scopeLogs;
  return resourceLogs;
}
/** Decode an OTLP HTTP protobuf ExportLogsServiceRequest into the JSON mapping used by the rest of the receiver. */
export function decodeOtlpLogsRequest(bytes: Uint8Array): ObjectValue {
  const resourceLogs: ObjectValue[] = [];
  read(new Reader(bytes), (id, wire, r) => {
    if (id === 1 && wire === 2) resourceLogs.push(r.message(decodeResourceLogs));
    else r.skip(wire);
  });
  return resourceLogs.length ? { resourceLogs } : {};
}
function encodeVarint(value: number | bigint): Buffer {
  let n = typeof value === 'bigint' ? value : BigInt(value);
  if (n < 0n) n += 0x10000000000000000n;
  const out: number[] = [];
  while (n > 0x7fn) { out.push(Number(n & 0x7fn) | 0x80); n >>= 7n; }
  out.push(Number(n));
  return Buffer.from(out);
}
function key(field: number, wire: number): Buffer { return encodeVarint((field << 3) | wire); }
function encodeString(field: number, value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  return Buffer.concat([key(field, 2), encodeVarint(bytes.length), bytes]);
}
function encodeMessage(field: number, value: Buffer): Buffer {
  return Buffer.concat([key(field, 2), encodeVarint(value.length), value]);
}
/** Encode ExportLogsServiceResponse. Empty success is a zero-length message. */
export function encodeOtlpLogsResponse(body: unknown): Buffer {
  if (!object(body) || !object(body.partialSuccess)) return Buffer.alloc(0);
  const partial = body.partialSuccess;
  const parts: Buffer[] = [];
  const rejected = Number(partial.rejectedLogRecords ?? 0);
  if (rejected) parts.push(Buffer.concat([key(1, 0), encodeVarint(rejected)]));
  if (typeof partial.errorMessage === 'string' && partial.errorMessage) parts.push(encodeString(2, partial.errorMessage));
  if (!parts.length) return Buffer.alloc(0);
  return encodeMessage(1, Buffer.concat(parts));
}
/** Encode google.rpc.Status for OTLP HTTP error bodies. */
export function encodeRpcStatus(body: unknown): Buffer {
  const parts: Buffer[] = [];
  if (object(body) && body.code !== undefined) parts.push(Buffer.concat([key(1, 0), encodeVarint(Number(body.code))]));
  if (object(body) && typeof body.message === 'string' && body.message) parts.push(encodeString(2, body.message));
  return Buffer.concat(parts);
}
function decodePartial(reader: Reader): ObjectValue {
  const partial: ObjectValue = {};
  read(reader, (id, wire, r) => {
    if (id === 1 && wire === 0) partial.rejectedLogRecords = r.int64String();
    else if (id === 2 && wire === 2) partial.errorMessage = r.string();
    else r.skip(wire);
  });
  return partial;
}
/** Decode ExportLogsServiceResponse; used by tests. */
export function decodeOtlpLogsResponse(bytes: Uint8Array): ObjectValue {
  const out: ObjectValue = {};
  read(new Reader(bytes), (id, wire, r) => {
    if (id === 1 && wire === 2) out.partialSuccess = r.message(decodePartial);
    else r.skip(wire);
  });
  return out;
}
