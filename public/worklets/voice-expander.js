class VoiceExpanderProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'marginDb', defaultValue: 6, minValue: 2, maxValue: 18, automationRate: 'k-rate' },
      { name: 'reductionDb', defaultValue: 8, minValue: 0, maxValue: 24, automationRate: 'k-rate' },
      { name: 'attackMs', defaultValue: 12, minValue: 2, maxValue: 100, automationRate: 'k-rate' },
      { name: 'releaseMs', defaultValue: 260, minValue: 40, maxValue: 1000, automationRate: 'k-rate' }
    ];
  }

  constructor() {
    super();
    this.noiseFloorDb = -55;
    this.gain = 1;
    this.blocks = 0;
    this.reportBlocks = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0], output = outputs[0];
    if (!input?.length || !output?.length) return true;
    let sum = 0, count = 0;
    for (const channel of input) for (let index = 0; index < channel.length; index++) { sum += channel[index] * channel[index]; count++; }
    const db = 20 * Math.log10(Math.max(1e-7, Math.sqrt(sum / Math.max(1, count))));
    this.blocks++;
    if (this.blocks < 180) this.noiseFloorDb += (Math.min(-28, db) - this.noiseFloorDb) * .035;
    else if (db < this.noiseFloorDb + 10) this.noiseFloorDb += (db - this.noiseFloorDb) * .0025;
    else this.noiseFloorDb += (-55 - this.noiseFloorDb) * .00002;
    this.noiseFloorDb = Math.max(-68, Math.min(-28, this.noiseFloorDb));
    const margin = parameters.marginDb[0], reduction = parameters.reductionDb[0];
    const threshold = this.noiseFloorDb + margin;
    const distance = Math.max(0, threshold - db);
    const reductionNow = Math.min(reduction, distance * .8);
    const target = 10 ** (-reductionNow / 20);
    const timeMs = target > this.gain ? parameters.attackMs[0] : parameters.releaseMs[0];
    const coefficient = 1 - Math.exp(-128 / (sampleRate * Math.max(.002, timeMs / 1000)));
    this.gain += (target - this.gain) * coefficient;
    for (let channelIndex = 0; channelIndex < output.length; channelIndex++) {
      const source = input[Math.min(channelIndex, input.length - 1)], destination = output[channelIndex];
      if (!source) { destination.fill(0); continue; }
      for (let index = 0; index < destination.length; index++) destination[index] = source[index] * this.gain;
    }
    if (++this.reportBlocks >= 188) { this.reportBlocks = 0; this.port.postMessage({ noiseFloorDb: this.noiseFloorDb }); }
    return true;
  }
}

registerProcessor('voice-expander', VoiceExpanderProcessor);
