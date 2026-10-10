package expo.modules.cuenative

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val ALERTS_CHANNEL = "cue_alerts"

class CueNativeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CueNative")

    Events("onWakeWordDetected", "onSpeechPartial", "onSpeechResult", "onSpeechError", "onAudioCaptured", "onAudioError", "onBackgroundCommand")

    Function("startHeartbeatService") {
      val ctx = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      ctx.startForegroundService(Intent(ctx, CueHeartbeatService::class.java))
    }

    Function("stopHeartbeatService") {
      val ctx = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      CueHeartbeatService.setEnabled(ctx, false) // an explicit stop must not come back after a reboot
      ctx.stopService(Intent(ctx, CueHeartbeatService::class.java))
    }

    // True once if "Hey Cue" was heard in the last few seconds (the app was opened by it), so it can start listening.
    Function("consumePendingWake") {
      val at = CueWakeWordBus.pendingWakeAt
      CueWakeWordBus.pendingWakeAt = 0L
      at != 0L && System.currentTimeMillis() - at < 20_000
    }

    // The command "Hey Cue" heard while the app was off screen, once, if it is still fresh.
    Function("consumePendingClip") {
      val clip = CueWakeWordBus.pendingClip
      val at = CueWakeWordBus.pendingClipAt
      CueWakeWordBus.pendingClip = null
      if (System.currentTimeMillis() - at < CueWakeWordBus.CLIP_LIFETIME_MS) clip else null
    }

    // Android may pause a backgrounded app with the screen off unless the user exempts it from battery optimisation.
    Function("isIgnoringBatteryOptimizations") {
      val ctx = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      ctx.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(ctx.packageName)
    }

    Function("requestIgnoreBatteryOptimizations") {
      val ctx = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${ctx.packageName}"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      ctx.startActivity(intent)
    }

    Function("startWakeWordService") {
      CueWakeWordBus.onDetected = { score -> sendEvent("onWakeWordDetected", mapOf("score" to score)) }
      CueWakeWordBus.onClip = { wav -> sendEvent("onBackgroundCommand", mapOf("wav" to wav)) }
      val ctx = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      ctx.startForegroundService(Intent(ctx, CueWakeWordService::class.java))
    }

    // While Cue talks the wake word is ignored. Capped, so a lost "done" can't mute it for good; a short tail
    // after covers the room's echo.
    Function("setSpeaking") { speaking: Boolean ->
      CueWakeWordBus.quietUntil = System.currentTimeMillis() + if (speaking) 30_000 else 700
    }

    Function("stopWakeWordService") {
      CueWakeWordBus.onDetected = null
      CueWakeWordBus.onClip = null
      val ctx = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      ctx.stopService(Intent(ctx, CueWakeWordService::class.java))
    }

    // Alerts from the price engine (guard fired, rule bought) — reachable from the headless task with the app closed.
    Function("notify") { title: String, body: String ->
      val ctx = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val nm = ctx.getSystemService(NotificationManager::class.java)
      nm.createNotificationChannel(NotificationChannel(ALERTS_CHANNEL, "Cue alerts", NotificationManager.IMPORTANCE_HIGH))
      val open = PendingIntent.getActivity(
        ctx, 0, ctx.packageManager.getLaunchIntentForPackage(ctx.packageName),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
      val notification = Notification.Builder(ctx, ALERTS_CHANNEL)
        .setContentTitle(title)
        .setContentText(body)
        .setStyle(Notification.BigTextStyle().bigText(body))
        .setSmallIcon(android.R.drawable.ic_dialog_info)
        .setContentIntent(open)
        .setAutoCancel(true)
        .build()
      nm.notify((System.currentTimeMillis() % Int.MAX_VALUE).toInt(), notification)
    }

    // Records one spoken command and returns it as base64 WAV, ending on its own when the user stops talking.
    Function("startAudioCapture") {
      AudioCapture.start { event, payload -> sendEvent(event, payload) }
    }

    Function("stopAudioCapture") {
      AudioCapture.stop()
    }

    Function("startSpeechRecognition") { hints: List<String> ->
      val ctx = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      SpeechRecognitionBridge.start(ctx, hints) { event, payload -> sendEvent(event, payload) }
    }

    Function("stopSpeechRecognition") {
      SpeechRecognitionBridge.stop()
    }

    // Proves from `adb logcat -s CueSpike` that JS is alive, even with the app in the background.
    Function("heartbeat") { message: String ->
      Log.i("CueSpike", message)
    }
  }
}
