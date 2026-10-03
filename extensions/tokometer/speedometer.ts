import type { FooterSpeedometer } from "./ui.ts";

function assistantMessageTimestamp(message: unknown): number | undefined {
  const value = (message as { timestamp?: unknown } | undefined)?.timestamp;
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : undefined;
}

function assistantOutputTokens(message: unknown): number {
  if (!message || typeof message !== "object") return 0;
  const output = ((message as { usage?: { output?: unknown } }).usage)?.output;
  return typeof output === "number" && Number.isFinite(output) && output > 0 ? Math.floor(output) : 0;
}

function assistantDeltaChars(assistantMessageEvent: unknown): number {
  if (!assistantMessageEvent || typeof assistantMessageEvent !== "object") return 0;
  const event = assistantMessageEvent as { delta?: unknown };
  return typeof event.delta === "string" ? Array.from(event.delta).length : 0;
}

function estimatedTokensFromChars(chars: number): number {
  return chars > 0 ? chars / 4 : 0;
}

export interface AssistantResponseEnd {
  startedAt?: number;
  speedometer?: FooterSpeedometer;
}

const WINDOW_MS = 1000;

export class AssistantSpeedTracker {
  private latestAssistantStartMs: number | undefined;
  private liveResponseMeter: { startedAt: number; estimatedTokens: number; lastStatusUpdateMs: number } | undefined;
  private readonly assistantStartByMessageTimestamp = new Map<number, number>();
  private samples: { at: number; tokens: number; gap: number }[] = [];
  private lastActivityAt: number | undefined;
  private peakTps = 0;

  snapshot(now = Date.now()): FooterSpeedometer | undefined {
    if (!this.liveResponseMeter) return undefined;
    this.samples = this.samples.filter((sample) => sample.at > now - WINDOW_MS);
    // Each sample contributes over the longer of the rolling window or its own
    // preceding gap, so a buffered flush keeps attributing its burst to the
    // silence before it even after a later small chunk joins the window.
    const tps = this.samples.reduce((sum, sample) => sum + sample.tokens / (Math.max(WINDOW_MS, sample.gap) / 1000), 0);
    if (tps > this.peakTps) this.peakTps = tps;
    return {
      tps,
      live: true,
      ...(this.lastActivityAt !== undefined ? { lastActivityAt: this.lastActivityAt } : {}),
      ...(this.peakTps > 0 ? { peak: this.peakTps } : {}),
    };
  }

  reset(): void {
    this.latestAssistantStartMs = undefined;
    this.liveResponseMeter = undefined;
    this.assistantStartByMessageTimestamp.clear();
    this.samples = [];
    this.lastActivityAt = undefined;
    this.peakTps = 0;
  }

  start(message: unknown, startedAt = Date.now()): void {
    this.reset();
    this.latestAssistantStartMs = startedAt;
    const messageTimestamp = assistantMessageTimestamp(message);
    if (messageTimestamp !== undefined) this.assistantStartByMessageTimestamp.set(messageTimestamp, startedAt);
    this.liveResponseMeter = { startedAt, estimatedTokens: 0, lastStatusUpdateMs: 0 };
  }

  update(assistantMessageEvent: unknown, now = Date.now()): FooterSpeedometer | undefined {
    const chars = assistantDeltaChars(assistantMessageEvent);
    if (chars <= 0) return undefined;

    this.liveResponseMeter ??= { startedAt: this.latestAssistantStartMs ?? now, estimatedTokens: 0, lastStatusUpdateMs: 0 };
    const tokens = estimatedTokensFromChars(chars);
    this.liveResponseMeter.estimatedTokens += tokens;
    const gap = Math.max(0, now - (this.lastActivityAt ?? this.liveResponseMeter.startedAt));
    const previous = this.samples.at(-1);
    // Coalesce into 50ms buckets; retain counts and timing only, never text.
    if (previous && now - previous.at < 50) previous.tokens += tokens;
    else this.samples.push({ at: now, tokens, gap });
    this.lastActivityAt = now;
    const snapshot = this.snapshot(now);
    if (now - this.liveResponseMeter.lastStatusUpdateMs < 200) return undefined;
    this.liveResponseMeter.lastStatusUpdateMs = now;
    return snapshot;
  }

  end(message: unknown, endedAt = Date.now()): AssistantResponseEnd {
    const startedAt = this.takeAssistantStart(message);
    const outputTokens = assistantOutputTokens(message);
    const peak = this.peakTps;
    let tps: number | undefined;

    if (outputTokens > 0 && typeof startedAt === "number" && endedAt > startedAt) {
      tps = outputTokens / ((endedAt - startedAt) / 1000);
    } else if (this.liveResponseMeter && this.liveResponseMeter.estimatedTokens > 0) {
      const elapsedSeconds = Math.max((endedAt - this.liveResponseMeter.startedAt) / 1000, 1);
      tps = this.liveResponseMeter.estimatedTokens / elapsedSeconds;
    }

    this.reset();
    // The whole-response average settles the meter but never overwrites the
    // measured response peak, which stays visible through the completion hold.
    const speedometer: FooterSpeedometer | undefined = tps !== undefined || peak > 0
      ? { tps: tps ?? 0, ...(peak > 0 ? { peak } : {}) }
      : undefined;
    return {
      ...(startedAt !== undefined ? { startedAt } : {}),
      ...(speedometer ? { speedometer } : {}),
    };
  }

  private takeAssistantStart(message: unknown): number | undefined {
    const messageTimestamp = assistantMessageTimestamp(message);
    if (messageTimestamp !== undefined) {
      const startedAt = this.assistantStartByMessageTimestamp.get(messageTimestamp);
      this.assistantStartByMessageTimestamp.delete(messageTimestamp);
      if (startedAt !== undefined) return startedAt;
    }
    return this.latestAssistantStartMs ?? messageTimestamp;
  }
}
