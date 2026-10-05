package expo.modules.cuenative

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Brings the price service back after a reboot or an app update, so rules keep running without the user reopening
 * Cue. Only the price service can start this way: Android 15 does not let a boot receiver start a microphone
 * service, so "Hey Cue" comes back the next time the app is opened.
 */
class CueBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
    if (!CueHeartbeatService.isEnabled(context)) return
    try {
      context.startForegroundService(Intent(context, CueHeartbeatService::class.java))
    } catch (e: Exception) {
      Log.w("CueBoot", "could not restart the price service", e)
    }
  }
}
