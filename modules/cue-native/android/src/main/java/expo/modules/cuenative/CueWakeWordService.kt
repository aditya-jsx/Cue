package expo.modules.cuenative

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.content.ContextCompat
import kotlin.concurrent.thread

/**
 * Foreground microphone service running the "Hey Cue" wake-word detector continuously.
 * A detection only fires after CONSECUTIVE_FRAMES_REQUIRED consecutive above-threshold frames
 * (~240ms sustained), then enters a cooldown — both are cheap mitigations for the model's
 * measured false-positive rate (see WakeWordDetector / the Voice folder training notes) that
 * don't require a better model, just don't trust a single noisy frame.
 */
class CueWakeWordService : Service() {
  private var detector: WakeWordDetector? = null
  private var audioRecord: AudioRecord? = null
  @Volatile private var running = false

  override fun onBind(intent: Intent?): IBinder? = null

  @SuppressLint("MissingPermission") // checked explicitly below before starting AudioRecord
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (running) return START_STICKY
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      Log.w("CueWakeWord", "RECORD_AUDIO not granted, refusing to start")
      stopSelf()
      return START_NOT_STICKY
    }

    val nm = getSystemService(NotificationManager::class.java)
    nm.createNotificationChannel(NotificationChannel(CHANNEL, "Cue wake word", NotificationManager.IMPORTANCE_LOW))
    // Separate high-importance channel: only a HIGH channel's full-screen intent actually pops over
    // whatever's on screen (lock screen, another app) instead of just sitting quietly in the shade.
    nm.createNotificationChannel(NotificationChannel(ALERT_CHANNEL, "Cue heard you", NotificationManager.IMPORTANCE_HIGH))
    val notification: Notification = Notification.Builder(this, CHANNEL)
      .setContentTitle("Cue is listening")
      .setContentText("Say \"Hey Cue\" to start")
      .setSmallIcon(android.R.drawable.ic_btn_speak_now)
      .setOngoing(true)
      .build()
    if (Build.VERSION.SDK_INT >= 29) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }

    running = true
    thread(name = "CueWakeWordLoop") { runDetectionLoop() }
    return START_STICKY
  }

  @SuppressLint("MissingPermission")
  private fun runDetectionLoop() {
    val minBuffer = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    val record = AudioRecord(
      MediaRecorder.AudioSource.VOICE_RECOGNITION,
      SAMPLE_RATE,
      AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_16BIT,
      maxOf(minBuffer, WakeWordDetector.CHUNK_SAMPLES * 4),
    )
    audioRecord = record

    try {
      detector = WakeWordDetector(applicationContext)
    } catch (e: Exception) {
      Log.e("CueWakeWord", "Failed to load wake word models", e)
      stopSelf()
      return
    }

    record.startRecording()
    val chunk = ShortArray(WakeWordDetector.CHUNK_SAMPLES)
    var consecutiveHits = 0
    var cooldownFramesLeft = 0

    while (running) {
      var offset = 0
      while (offset < chunk.size && running) {
        val n = record.read(chunk, offset, chunk.size - offset)
        if (n <= 0) break
        offset += n
      }
      if (!running || offset < chunk.size) continue

      val score = detector?.processChunk(chunk) ?: continue

      if (cooldownFramesLeft > 0) {
        cooldownFramesLeft--
        continue
      }

      if (score >= DETECTION_THRESHOLD) {
        consecutiveHits++
      } else {
        consecutiveHits = 0
      }

      if (consecutiveHits >= CONSECUTIVE_FRAMES_REQUIRED) {
        consecutiveHits = 0
        cooldownFramesLeft = COOLDOWN_FRAMES
        Log.i("CueWakeWord", "Detected \"Hey Cue\" (score=$score)")
        playChime()
        bringToForeground()
        CueWakeWordBus.onDetected?.invoke(score)
      }
    }

    record.stop()
    record.release()
    detector?.close()
  }

  private fun playChime() {
    try {
      MediaPlayer.create(this, R.raw.cue_chime)?.apply {
        setOnCompletionListener { it.release() }
        start()
      }
    } catch (e: Exception) {
      Log.w("CueWakeWord", "Couldn't play chime", e)
    }
  }

  /**
   * Brings the app to the foreground even from the background. A direct startActivity() is
   * best-effort (Android 10+ blocks background activity starts in most cases), so a full-screen
   * notification intent on a HIGH-importance channel is the real, OS-sanctioned mechanism here —
   * the same one calls/alarms use to pop over the lock screen or whatever's on screen.
   */
  private fun bringToForeground() {
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
    } ?: return

    try {
      startActivity(launchIntent)
    } catch (e: Exception) {
      Log.w("CueWakeWord", "Direct foreground launch blocked, falling back to full-screen notification", e)
    }

    val pendingIntent = PendingIntent.getActivity(
      this, 0, launchIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val alert = Notification.Builder(this, ALERT_CHANNEL)
      .setContentTitle("Cue heard you")
      .setContentText("Listening for your command…")
      .setSmallIcon(android.R.drawable.ic_btn_speak_now)
      .setPriority(Notification.PRIORITY_HIGH)
      .setCategory(Notification.CATEGORY_CALL)
      .setFullScreenIntent(pendingIntent, true)
      .setContentIntent(pendingIntent)
      .setAutoCancel(true)
      .setTimeoutAfter(4_000) // only a nudge to open Cue; once it's open it would just cover the listening screen
      .build()
    getSystemService(NotificationManager::class.java).notify(ALERT_NOTIFICATION_ID, alert)
  }

  override fun onDestroy() {
    running = false
    super.onDestroy()
  }

  companion object {
    private const val CHANNEL = "cue_wake_word"
    private const val ALERT_CHANNEL = "cue_wake_word_alert"
    private const val NOTIFICATION_ID = 1002
    private const val ALERT_NOTIFICATION_ID = 1003
    private const val SAMPLE_RATE = 16000
    private const val DETECTION_THRESHOLD = 0.5f
    private const val CONSECUTIVE_FRAMES_REQUIRED = 3 // ~240ms sustained, cuts single-frame noise spikes
    private const val COOLDOWN_FRAMES = 25 // ~2s @ 80ms/frame, avoid re-firing on the same utterance
  }
}

/** In-process bridge from the service (no JS runtime access) to the module (which owns sendEvent). */
object CueWakeWordBus {
  var onDetected: ((score: Float) -> Unit)? = null
}
