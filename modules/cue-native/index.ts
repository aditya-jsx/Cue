import { requireNativeModule } from 'expo'
import { NativeModule } from 'expo-modules-core'

type CueNativeEvents = {
  onAudioCaptured(payload: { wav: string }): void
  onAudioError(payload: { message: string }): void
  onSpeechError(payload: { message: string }): void
  onSpeechPartial(payload: { text: string }): void
  onSpeechResult(payload: { text: string }): void
  onWakeWordDetected(payload: { score: number }): void
}

declare class CueNativeModule extends NativeModule<CueNativeEvents> {
  heartbeat(message: string): void
  notify(title: string, body: string): void
  startAudioCapture(): void
  startHeartbeatService(): void
  stopAudioCapture(): void
  stopHeartbeatService(): void
  startSpeechRecognition(hints: string[]): void
  startWakeWordService(): void
  stopSpeechRecognition(): void
  stopWakeWordService(): void
}

export default requireNativeModule<CueNativeModule>('CueNative')
