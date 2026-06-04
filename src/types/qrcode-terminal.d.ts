declare module "qrcode-terminal" {
  export interface GenerateOptions {
    small?: boolean;
  }

  export function generate(
    input: string,
    options: GenerateOptions,
    callback: (qrcode: string) => void,
  ): void;

  export function generate(
    input: string,
    callback: (qrcode: string) => void,
  ): void;

  export function generate(input: string, options?: GenerateOptions): void;

  const qrcode: {
    generate: typeof generate;
  };

  export default qrcode;
}
