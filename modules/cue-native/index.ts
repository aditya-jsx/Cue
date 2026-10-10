import { requireNativeModule } from 'expo'
import { NativeModule } from 'expo-modules-core'

type CueNativeEvents = {
  onAudioCaptured(payload: { wav: string }): void
  onAudioError(payload: { message: string }): void
  onBackgroundCommand(payload: { wav: string }): void
  onSpeechError(payload: { message: string }): void
  onSpeechPartial(payload: { text: string }): void
  onSpeechResult(payload: { text: string }): void
  onWakeWordDetected(payload: { score: number }): void
}

declare class CueNativeModule extends NativeModule<CueNativeEvents> {
  consumePendingClip(): string | null
  consumePendingWake(): boolean
  heartbeat(message: string): void
  isIgnoringBatteryOptimizations(): boolean
  notify(title: string, body: string): void
  requestIgnoreBatteryOptimizations(): void
  setSpeaking(speaking: boolean): void
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
