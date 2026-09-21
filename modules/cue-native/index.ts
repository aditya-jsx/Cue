import { requireNativeModule } from 'expo'

type CueNativeModule = {
  heartbeat(message: string): void
  startHeartbeatService(): void
  stopHeartbeatService(): void
}

export default requireNativeModule<CueNativeModule>('CueNative')
