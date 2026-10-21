// Minimal stand-in for @mariozechner/pi-tui (an optional peer dependency that pi
// provides at runtime). Only what the extension touches is implemented.
export class Box {
  children: unknown[] = [];

  constructor(
    public paddingX = 0,
    public paddingY = 0,
    public background?: (text: string) => string,
  ) {}

  addChild(child: unknown): void {
    this.children.push(child);
  }
}

export class Text {
  constructor(
    public text = "",
    public paddingX = 0,
    public paddingY = 0,
  ) {}
}
