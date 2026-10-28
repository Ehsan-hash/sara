// Audio worklet: forwards microphone frames (mono Float32) to the main thread.
class SaraRecorder extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('sara-recorder', SaraRecorder);
