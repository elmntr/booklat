// AudioContext performs device-rate conversion to 16 kHz before this processor.
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new ArrayBuffer(8000);
    this.view = new DataView(this.frame);
    this.count = 0;
    this.energy = 0;
    this.stopped = false;
    this.port.onmessage = ({ data }) => {
      if (data === 'stop') {
        this.emit();
        this.stopped = true;
        this.port.postMessage({ type: 'stopped' });
      }
    };
  }
  emit() {
    if (!this.count) return;
    const pcm = this.frame.slice(0, this.count * 2);
    this.port.postMessage({ type: 'frame', pcm, rms: Math.sqrt(this.energy / this.count) }, [pcm]);
    this.count = 0;
    this.energy = 0;
  }
  process(inputs) {
    if (this.stopped) return false;
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let sample = 0;
      for (const channel of channels) sample += channel[i] / channels.length;
      sample = Math.max(-1, Math.min(1, sample));
      this.view.setInt16(this.count * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
      this.energy += sample * sample;
      this.count++;
      if (this.count === 4000) this.emit();
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
