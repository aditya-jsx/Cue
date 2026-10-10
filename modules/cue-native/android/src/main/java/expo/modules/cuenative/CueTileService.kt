package expo.modules.cuenative

import android.annotation.SuppressLint
import android.app.ActivityManager
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.service.quicksettings.TileService

/**
 * The "Talk to Cue" Quick Settings tile: one swipe down from any app, and Cue opens already listening. It uses the
 * same hand-off as an off-screen "Hey Cue": mark the wake, open the app, and the app starts listening when it shows.
 */
class CueTileService : TileService() {
  @SuppressLint("StartActivityAndCollapseDeprecated") // the Intent form is the only one before Android 14
  override fun onClick() {
    // Cue already on screen (the shade was pulled over it): it never leaves the foreground, so tell it directly.
    val info = ActivityManager.RunningAppProcessInfo().also { ActivityManager.getMyMemoryState(it) }
    val onScreen = info.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
    CueWakeWordBus.pendingWakeAt = System.currentTimeMillis()
    if (onScreen) CueWakeWordBus.onDetected?.invoke(1f)
    val open = packageManager.getLaunchIntentForPackage(packageName)?.apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
    } ?: return
    // Locked phone: Android asks to unlock first, then opens Cue.
    unlockAndRun {
      if (Build.VERSION.SDK_INT >= 34) {
        startActivityAndCollapse(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE))
      } else {
        @Suppress("DEPRECATION")
        startActivityAndCollapse(open)
      }
    }
  }
}
