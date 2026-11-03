// Minimal AudioWorkletGlobalScope typings (TypeScript ships no "audioworklet" lib).
declare const currentFrame: number;
declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: new () => unknown): void;
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}
