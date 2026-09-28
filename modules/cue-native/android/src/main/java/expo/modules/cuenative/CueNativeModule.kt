package expo.modules.cuenative

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.util.Log
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val ALERTS_CHANNEL = "cue_alerts"

class CueNativeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CueNative")

    Events("onWakeWordDetected", "onSpeechPartial", "onSpeechResult", "onSpeechError")

    Function("startHeartbeatService") {
      val ctx = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      ctx.startForegroundService(Intent(ctx, CueHeartbeatService::class.java))
    }

    Function("stopHeartbeatService") {
      val ctx = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      ctx.stopService(Intent(ctx, CueHeartbeatService::class.java))
    }

    Function("startWakeWordService") {
      CueWakeWordBus.onDetected = { score -> sendEvent("onWakeWordDetected", mapOf("score" to score)) }
      val ctx = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      ctx.startForegroundService(Intent(ctx, CueWakeWordService::class.java))
    }

    Function("stopWakeWordService") {
      CueWakeWordBus.onDetected = null
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
