package expo.modules.cuenative

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.ActivityManager
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
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/**
 * Foreground microphone service running the "Hey Cue" wake-word detector continuously.
 * A detection only fires after HITS_REQUIRED above-threshold frames within the last 6 frames
 * (~480ms), then enters a cooldown — both are cheap mitigations for the model's
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
    var recentHits = 0 // one bit per recent frame, newest lowest
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

      // Not strictly consecutive: from across a room the score flickers (high, low, high, high), which a
      // consecutive-run rule kept resetting even though the model clearly heard "Hey Cue".
      recentHits = ((recentHits shl 1) or (if (score >= DETECTION_THRESHOLD) 1 else 0)) and WINDOW_MASK
      if (System.currentTimeMillis() < CueWakeWordBus.quietUntil) recentHits = 0 // Cue itself is talking
      if (Integer.bitCount(recentHits) >= HITS_REQUIRED) {
        recentHits = 0
        cooldownFramesLeft = COOLDOWN_FRAMES
        Log.i("CueWakeWord", "Detected \"Hey Cue\" (score=$score)")
        playChime()
        if (appIsOnScreen()) {
          CueWakeWordBus.pendingWakeAt = System.currentTimeMillis()
          bringToForeground()
          CueWakeWordBus.onDetected?.invoke(score)
        } else {
          captureCommandInBackground(record)
          cooldownFramesLeft = COOLDOWN_FRAMES
        }
      }
    }

    record.stop()
    record.release()
    detector?.close()
  }

  /** True while Cue's own screen is showing; a foreground service alone ranks lower than that. */
  private fun appIsOnScreen(): Boolean {
    val info = ActivityManager.RunningAppProcessInfo()
    ActivityManager.getMyMemoryState(info)
    return info.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
  }

  /**
   * Cue isn't on screen, and Android won't let it open itself from here. So this service listens for the command itself
   * (the wake-word recording is paused meanwhile, one mic client at a time) and hands the clip over in a notification.
   * Nothing is understood or done here: tapping the notification opens Cue, which runs the usual confirmation.
   */
  private fun captureCommandInBackground(record: AudioRecord) {
    record.stop()
    Thread.sleep(CHIME_MS) // otherwise the chime itself is what gets recorded
    val done = CountDownLatch(1)
    var clip: String? = null
    AudioCapture.start { event, payload ->
      if (event == "onAudioCaptured") clip = payload["wav"] as? String
      done.countDown()
    }
    if (!done.await(CAPTURE_WAIT_SECONDS, TimeUnit.SECONDS)) AudioCapture.stop()
    record.startRecording()

    // The app is alive in the background: it asks the assistant what was said and notifies with that.
    val toApp = CueWakeWordBus.onClip
    if (clip != null && toApp != null) return toApp(clip!!)

    CueWakeWordBus.pendingClip = clip
    CueWakeWordBus.pendingClipAt = System.currentTimeMillis()
    val alert = if (clip == null) {
      // Nothing was said after the chime: just say so, the next "Hey Cue" tries again.
      Notification.Builder(this, ALERT_CHANNEL)
        .setContentTitle("Cue didn't hear a command")
        .setContentText("Say \"Hey Cue\" and try again")
        .setSmallIcon(android.R.drawable.ic_btn_speak_now)
        .setAutoCancel(true)
        .setTimeoutAfter(10_000)
        .build()
    } else {
      val open = packageManager.getLaunchIntentForPackage(packageName)?.apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
      } ?: return
      val pendingIntent = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      Notification.Builder(this, ALERT_CHANNEL)
        .setContentTitle("Cue heard your command")
        .setContentText("Tap to review and approve it")
        .setSmallIcon(android.R.drawable.ic_btn_speak_now)
        .setPriority(Notification.PRIORITY_HIGH)
        .setFullScreenIntent(pendingIntent, true)
        .setContentIntent(pendingIntent)
        .setAutoCancel(true)
        .setTimeoutAfter(CueWakeWordBus.CLIP_LIFETIME_MS)
        .build()
    }
    getSystemService(NotificationManager::class.java).notify(ALERT_NOTIFICATION_ID, alert)
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
    private const val DETECTION_THRESHOLD = 0.7f // real attempts from across a room scored 0.68+, a false trigger leaned on a 0.56
    private const val HITS_REQUIRED = 3 // cuts single-frame noise spikes
    private const val WINDOW_MASK = 0b111111 // the last 6 frames, ~480ms
    private const val CHIME_MS = 1500L
    private const val CAPTURE_WAIT_SECONDS = 12L
    private const val COOLDOWN_FRAMES = 25 // ~2s @ 80ms/frame, avoid re-firing on the same utterance
  }
}

/** In-process bridge from the service (no JS runtime access) to the module (which owns sendEvent). */
object CueWakeWordBus {
  var onDetected: ((score: Float) -> Unit)? = null
  var onClip: ((wav: String) -> Unit)? = null

  /** Detection is ignored until then: Cue's own voice ("Hi, I'm Cue") can sound like "Hey Cue". */
  @Volatile var quietUntil: Long = 0L

  /**
   * When the last wake happened. With the app closed, nothing in JS is listening yet when the service detects "Hey Cue",
   * so the event is lost; the app reads this as it starts and begins listening if the wake was just now.
   */
  @Volatile var pendingWakeAt: Long = 0L

  /** A command heard while Cue was off screen (base64 WAV), waiting for the app to be opened and take it. */
  @Volatile var pendingClip: String? = null
  @Volatile var pendingClipAt: Long = 0L
  const val CLIP_LIFETIME_MS = 120_000L
}
