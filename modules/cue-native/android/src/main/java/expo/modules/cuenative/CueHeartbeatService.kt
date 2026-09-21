package expo.modules.cuenative

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

// Spike: foreground service that keeps a headless JS task ("CueHeartbeat") alive so JS timers
// and fetch keep running while the app is backgrounded. Real version will use type=microphone.
class CueHeartbeatService : HeadlessJsTaskService() {
  @SuppressLint("NewApi") // ponytail: spike targets API 26+, real service must handle minSdk 24
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val nm = getSystemService(NotificationManager::class.java)
    nm.createNotificationChannel(NotificationChannel(CHANNEL, "Cue agent", NotificationManager.IMPORTANCE_LOW))
    val notification: Notification = Notification.Builder(this, CHANNEL)
      .setContentTitle("Cue is running")
      .setContentText("Background agent spike")
      .setSmallIcon(android.R.drawable.ic_dialog_info)
      .setOngoing(true)
      .build()
    if (Build.VERSION.SDK_INT >= 29) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    return super.onStartCommand(intent, flags, startId)
  }

  // timeout 0 = never; allowed in foreground so it also runs while the app is open.
  override fun getTaskConfig(intent: Intent?) =
    HeadlessJsTaskConfig("CueHeartbeat", Arguments.createMap(), 0, true)

  companion object {
    private const val CHANNEL = "cue_agent"
    private const val NOTIFICATION_ID = 1001
  }
}
