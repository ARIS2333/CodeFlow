/** Complete top-level JSON fields, plus complete missingSymbols array items. */
export type JsonStreamValue =
  | { type: 'field'; key: string; value: unknown }
  | { type: 'item'; key: 'missingSymbols'; value: unknown };

/**
 * One-pass delimiter scanner. JSON.parse validates only CLOSED values; braces
 * inside strings and escaped quotes do not affect depth. No closing-bracket
 * guessing or JSON repair is applied to incomplete prefixes.
 */
export class JsonObjectStream {
  private text = '';
  private cursor = 0;
  private stack: string[] = [];
  private quoted = false;
  private escaped = false;
  private started = false;
  private ended = false;
  private segmentStart = 0;
  private fieldEnd = -1;
  private fieldKey = '';
  private itemStart = -1;
  private seen = new Set<string>();
  private values: Record<string, unknown> = Object.create(null);
  private onValue: (event: JsonStreamValue) => void;

  constructor(onValue: (event: JsonStreamValue) => void) {
    this.onValue = onValue;
  }

  private emitField(end: number) {
    if (this.fieldEnd >= 0) {
      if (this.text.slice(this.fieldEnd, end).trim()) throw new Error('Unexpected text after JSON field');
      return;
    }
    const entry = JSON.parse(`{${this.text.slice(this.segmentStart, end)}}`) as Record<string, unknown>;
    const keys = Object.keys(entry);
    if (keys.length !== 1) throw new Error('Expected one JSON field');
    const key = keys[0];
    if (this.seen.has(key)) throw new Error(`Duplicate JSON field: ${key}`);
    this.seen.add(key);
    this.values[key] = entry[key];
    this.fieldEnd = end;
    this.onValue({ type: 'field', key, value: entry[key] });
  }

  private emitItem(end: number) {
    if (this.itemStart < 0) return;
    const value = JSON.parse(this.text.slice(this.itemStart, end));
    this.itemStart = -1;
    this.onValue({ type: 'item', key: 'missingSymbols', value });
  }

  push(delta: string) {
    this.text += delta;
    if (this.text.length > 2_000_000) throw new Error('Model JSON is too large');
    for (; this.cursor < this.text.length; this.cursor++) {
      const i = this.cursor;
      const c = this.text[i];
      if (this.ended) continue;
      if (!this.started) {
        if (c !== '{') continue;
        const prefix = this.text.slice(0, i).trim();
        if (prefix && !/^```(?:json)?\s*$/i.test(prefix)) throw new Error('Expected a JSON object');
        this.started = true;
        this.stack.push('{');
        this.segmentStart = i + 1;
        continue;
      }
      if (this.quoted) {
        if (this.escaped) this.escaped = false;
        else if (c === '\\') this.escaped = true;
        else if (c === '"') this.quoted = false;
        continue;
      }

      // Capture each complete suggestion before the rest of its array arrives.
      const inSuggestions = this.stack.length === 2 && this.stack[1] === '[' && this.fieldKey === 'missingSymbols';
      if (inSuggestions && this.itemStart < 0 && !/[\s,\]]/.test(c)) this.itemStart = i;
      if (c === '"') { this.quoted = true; continue; }
      if (c === '{' || c === '[') {
        if (this.stack.length === 1) {
          if (this.fieldEnd >= 0) throw new Error('Missing comma between JSON fields');
          const prefix = JSON.parse(`{${this.text.slice(this.segmentStart, i)}null}`);
          this.fieldKey = Object.keys(prefix)[0];
          if (this.seen.has(this.fieldKey)) throw new Error(`Duplicate JSON field: ${this.fieldKey}`);
        }
        this.stack.push(c);
      } else if (c === '}' || c === ']') {
        if (this.stack.at(-1) !== (c === '}' ? '{' : '[')) throw new Error('Mismatched JSON delimiter');
        if (inSuggestions) this.emitItem(i);
        if (this.stack.length === 1) {
          // Empty objects are allowed here, but a trailing comma is not.
          if (this.text.slice(this.segmentStart, i).trim() || this.seen.size) this.emitField(i);
          this.ended = true;
          this.stack.pop();
          continue;
        }
        this.stack.pop();
        if (this.stack.length === 1) this.emitField(i + 1);
        else if (this.stack.length === 2 && this.fieldKey === 'missingSymbols') this.emitItem(i + 1);
      } else if (c === ',') {
        if (inSuggestions) this.emitItem(i);
        if (this.stack.length === 1) {
          this.emitField(i);
          this.segmentStart = i + 1;
          this.fieldEnd = -1;
          this.fieldKey = '';
        }
      }
    }
  }

  finish(): Record<string, unknown> {
    if (!this.ended || this.quoted) throw new Error('Model stream ended with incomplete JSON');
    // Validate the complete document as well as its emitted fields.
    const body = this.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    JSON.parse(body);
    return this.values;
  }
}
