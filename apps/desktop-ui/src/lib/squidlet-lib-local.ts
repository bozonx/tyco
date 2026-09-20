
/**
 * Simple hash function for generating unique IDs.
 */
function hashSum(o: any): string {
  const str = JSON.stringify(o);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  const result = Math.abs(hash).toString(16);
  return result.padStart(8, '0');
}

let counter = Math.floor(Math.random() * 1000000);
let instanceId: string | undefined;

function getRuntimeId(): string {
  if (!instanceId) {
    instanceId = hashSum(Math.random().toString() + Date.now().toString());
  }
  return instanceId;
}

export function makeUniqId(_bytes: number = 8): string {
  counter++;
  return hashSum(getRuntimeId() + counter.toString());
}

export function truncate(src: string | undefined | null, maxLength: number, suffix: string = '...'): string {
  if (!src) return '';
  if (src.length <= maxLength) return src;
  return src.slice(0, maxLength) + suffix;
}

export function toCamelCase(text?: string): string {
  if (!text) return '';
  return text
    .split(/[\s-_]+/)
    .map((word, index) =>
      index === 0
        ? word.toLowerCase()
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    )
    .join("");
}

export function toPascalCase(text?: string): string {
  if (!text) return '';
  return text
    .split(/[\s-_]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");
}

export function toSnakeCase(text?: string): string {
  if (!text) return '';
  return text
    .split(/[\s-_]+/)
    .map((word) => word.toLowerCase())
    .join("_");
}

export function toKebabCase(text?: string): string {
  if (!text) return '';
  return text
    .split(/[\s-_]+/)
    .map((word) => word.toLowerCase())
    .join("-");
}

export function normalizeText(text?: string): string {
  if (!text) return "";
  let words: string[] = [];
  if (text.includes(" ")) words = text.split(" ");
  else if (text.includes("_")) words = text.split("_");
  else if (text.includes("-")) words = text.split("-");
  else if (/[\p{Lu}]/u.test(text)) words = text.split(/(?=[\p{Lu}])/u);
  else words = [text];

  const normalizedWords = words
    .filter((word) => word.length > 0)
    .map((word, index) => {
      if (index === 0) return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      else return word.toLowerCase();
    });
  return normalizedWords.join(" ");
}

export type DefaultHandler = (...args: any[]) => void;

export class IndexedEventEmitter<T extends DefaultHandler = DefaultHandler> {
  private handlers: (T | undefined)[] = [];
  private indexes: { [index: string]: number[] } = {};
  private handlerEvents: (string | number | undefined)[] = [];

  emit = (eventName: string | number, ...args: any[]) => {
    if (!this.indexes[eventName]) return;
    const indexes = [...this.indexes[eventName]];
    for (const index of indexes) {
      const handler = this.handlers[index];
      if (handler) handler(...args);
    }
  }

  addListener(eventName: string | number, handler: T): number {
    if (!this.indexes[eventName]) this.indexes[eventName] = [];
    const index = this.handlers.length;
    this.handlers.push(handler);
    this.handlerEvents.push(eventName);
    this.indexes[eventName].push(index);
    return index;
  }

  removeListener(handlerIndex: number, eventName?: string | number): void {
    const resolvedEventName = eventName ?? this.handlerEvents[handlerIndex];
    if (resolvedEventName === undefined) return;
    if (!this.indexes[resolvedEventName]) return;
    const foundIndexInEvents = this.indexes[resolvedEventName].findIndex((item) => item === handlerIndex);
    if (foundIndexInEvents >= 0) {
      this.indexes[resolvedEventName].splice(foundIndexInEvents, 1);
      if (!this.indexes[resolvedEventName].length) delete this.indexes[resolvedEventName];
      delete this.handlers[handlerIndex];
      delete this.handlerEvents[handlerIndex];
    }
  }
}

export class DebounceCallIncreasing {
    private items: { [id: string]: { timeout: any, resolve: Function, reject: Function, promise: Promise<void> } } = {};

    invoke(cb: () => void, debounceMs: number, id: string = 'default'): Promise<void> {
        if (this.items[id]) {
            clearTimeout(this.items[id].timeout);
        } else {
            let resolveFn: any, rejectFn: any;
            const promise = new Promise<void>((res, rej) => {
                resolveFn = res;
                rejectFn = rej;
            });
            this.items[id] = { timeout: null, resolve: resolveFn, reject: rejectFn, promise };
        }

        this.items[id].timeout = setTimeout(() => {
            try {
                cb();
                this.items[id].resolve();
            } catch (e) {
                this.items[id].reject(e);
            }
            delete this.items[id];
        }, debounceMs);

        return this.items[id].promise;
    }
}
