package expo.modules.cuenative

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.PowerManager
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

// Foreground service that keeps the headless JS task ("CueHeartbeat") alive, so price checks and the rules that
// depend on them keep running while the app is backgrounded.
//
// Staying alive on a real phone takes three things beyond the service itself:
// - the type: Android 15 caps `dataSync` services at ~6 hours a day, so Android 14+ uses `specialUse` (no cap);
// - a partial wake lock: the poll is a JS timer, and timers stop in deep sleep unless the CPU is held awake;
// - restart: START_STICKY brings it back after a kill, and CueBootReceiver brings it back after a reboot.
class CueHeartbeatService : HeadlessJsTaskService() {
  private var wakeLock: PowerManager.WakeLock? = null

  @SuppressLint("NewApi") // ponytail: assumes API 26+ (notification channels); handle minSdk 24 if the app ever supports it
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val nm = getSystemService(NotificationManager::class.java)
    nm.createNotificationChannel(NotificationChannel(CHANNEL, "Cue agent", NotificationManager.IMPORTANCE_LOW))
    val notification: Notification = Notification.Builder(this, CHANNEL)
      .setContentTitle("Cue is watching prices")
      .setContentText("Your rules keep running in the background")
      .setSmallIcon(android.R.drawable.ic_dialog_info)
      .setOngoing(true)
      .build()
    when {
      Build.VERSION.SDK_INT >= 34 ->
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
      Build.VERSION.SDK_INT >= 29 ->
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
      else -> startForeground(NOTIFICATION_ID, notification)
    }
    holdWakeLock()
    setEnabled(this, true)
    super.onStartCommand(intent, flags, startId)
    return START_STICKY // the system restarts the service (with a null intent, which getTaskConfig ignores) after a kill
  }

  // ponytail: held for as long as the service lives (a 30 s poll can't wait on deep sleep); costs some battery,
  // so switch to an AlarmManager-driven poll if battery use ever matters more than timely rules.
  @SuppressLint("WakelockTimeout")
  private fun holdWakeLock() {
    if (wakeLock?.isHeld == true) return
    wakeLock = getSystemService(PowerManager::class.java)
      .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Cue:heartbeat")
      .also { it.acquire() }
  }

  override fun onDestroy() {
    wakeLock?.takeIf { it.isHeld }?.release()
    wakeLock = null
    super.onDestroy()
  }

  // timeout 0 = never; allowed in foreground so it also runs while the app is open.
  override fun getTaskConfig(intent: Intent?) =
    HeadlessJsTaskConfig("CueHeartbeat", Arguments.createMap(), 0, true)

  companion object {
    private const val CHANNEL = "cue_agent"
    private const val NOTIFICATION_ID = 1001
    private const val PREFS = "cue_background"
    private const val KEY_ENABLED = "heartbeat_enabled"

    /** Whether the user wants the service running, so a reboot knows whether to bring it back. */
    fun setEnabled(context: Context, enabled: Boolean) {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_ENABLED, enabled).apply()
    }

    fun isEnabled(context: Context): Boolean =
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_ENABLED, false)
  }
}
