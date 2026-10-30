"use client";

import { useEffect, useRef, useState } from "react";

export type SonificationSample = {
  value: number | null;
  amplitude: number | null;
  disorder?: number | null;
};

export default function RadarSonifier({
  samples,
  label,
  explanation,
}: {
  samples: SonificationSample[];
  label: string;
  explanation: string;
}) {
  const [playing, setPlaying] = useState(false);
  const sources = useRef<{ oscillator: OscillatorNode; noise: AudioBufferSourceNode; context: AudioContext } | null>(null);
  const timer = useRef<number | null>(null);

  function stop() {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    const active = sources.current;
    sources.current = null;
    if (active) {
      try { active.oscillator.stop(); } catch { /* already ended */ }
      try { active.noise.stop(); } catch { /* already ended */ }
      void active.context.close();
    }
    setPlaying(false);
  }

  function play() {
    stop();
    const valid = samples.filter(sample => sample.value !== null && sample.amplitude !== null);
    if (valid.length < 2) return;
    const AudioContextClass = window.AudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const duration = 0.11;
    const oscillator = context.createOscillator();
    const toneGain = context.createGain();
    const noise = context.createBufferSource();
    const noiseGain = context.createGain();
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * samples.length * duration), context.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < channel.length; index++) channel[index] = Math.random() * 2 - 1;
    noise.buffer = buffer;
    noise.loop = true;
    oscillator.type = "sine";
    oscillator.connect(toneGain);
    toneGain.connect(context.destination);
    noise.connect(noiseGain);
    noiseGain.connect(context.destination);
    const now = context.currentTime + 0.05;
    const values = valid.map(sample => sample.value as number);
    const low = Math.min(...values);
    const high = Math.max(...values);
    const range = Math.max(1e-6, high - low);
    const minAmplitude = Math.min(...valid.map(sample => Math.max(0, sample.amplitude ?? 0)));
    const maxAmplitude = Math.max(...valid.map(sample => Math.max(0, sample.amplitude ?? 0)));
    const amplitudeRange = Math.max(1e-6, maxAmplitude - minAmplitude);
    samples.forEach((sample, index) => {
      const start = now + index * duration;
      const isValid = sample.value !== null && sample.amplitude !== null;
      const tone = isValid ? 190 + ((sample.value as number - low) / range) * 670 : 190;
      const loudness = isValid ? 0.04 + ((Math.max(0, sample.amplitude ?? 0) - minAmplitude) / amplitudeRange) * 0.24 : 0;
      oscillator.frequency.setValueAtTime(tone, start);
      toneGain.gain.setValueAtTime(loudness, start);
      noiseGain.gain.setValueAtTime(isValid ? Math.min(0.12, Math.max(0, sample.disorder ?? 0) * 0.12) : 0, start);
    });
    oscillator.start(now);
    noise.start(now);
    oscillator.stop(now + samples.length * duration + 0.03);
    noise.stop(now + samples.length * duration + 0.03);
    sources.current = { oscillator, noise, context };
    setPlaying(true);
    timer.current = window.setTimeout(() => {
      sources.current = null;
      void context.close();
      setPlaying(false);
    }, samples.length * duration * 1000 + 200);
  }

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    const active = sources.current;
    if (active) {
      try { active.oscillator.stop(); } catch { /* already ended */ }
      try { active.noise.stop(); } catch { /* already ended */ }
      void active.context.close();
    }
  }, []);

  return <div className="radar-sonifier">
    <div><strong>{label}</strong><p>{explanation}</p></div>
    <div className="radar-sonifier__actions">
      <button type="button" onClick={playing ? stop : play} disabled={samples.filter(sample => sample.value !== null && sample.amplitude !== null).length < 2}>
        {playing ? "Stop transect" : "Hear transect"}
      </button>
      <span aria-live="polite">{playing ? "Playing sampled transect" : "Audio starts only when you press play"}</span>
    </div>
  </div>;
}
