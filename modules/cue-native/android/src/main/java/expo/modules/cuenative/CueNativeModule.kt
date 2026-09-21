package expo.modules.cuenative

import android.content.Intent
import android.util.Log
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class CueNativeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CueNative")

    Function("startHeartbeatService") {
      val ctx = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      ctx.startForegroundService(Intent(ctx, CueHeartbeatService::class.java))
    }

    Function("stopHeartbeatService") {
      val ctx = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      ctx.stopService(Intent(ctx, CueHeartbeatService::class.java))
    }

    // Proves from `adb logcat -s CueSpike` that JS is alive, even with the app in the background.
    Function("heartbeat") { message: String ->
      Log.i("CueSpike", message)
    }
  }
}
