package expo.modules.cuenative

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Base64
import android.util.Log
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.concurrent.thread
import kotlin.math.sqrt

/**
 * Records one spoken command and hands it back as a base64 WAV (16 kHz mono PCM16) for the assistant to hear.
 * It ends the clip on its own: shortly after the user stops talking, or on a hard time limit. A short pre-roll is kept
 * so the first word isn't clipped by the speech detector's reaction time.
 */
object AudioCapture {
  private const val SAMPLE_RATE = 16_000
  private const val FRAME_SAMPLES = 320 // 20 ms
  private const val FRAME_MS = 20
  private const val PRE_ROLL_FRAMES = 15 // 300 ms
  private const val MAX_CLIP_MS = 9_000
  private const val NO_SPEECH_MS = 6_000
  private const val END_SILENCE_MS = 1_400
  private const val SPEECH_START_FRAMES = 3
  private const val MIN_SPEECH_RMS = 600.0
  private const val MIN_QUIET_RMS = 300.0 // below this counts as silence; lower than the start level so soft words aren't cut off

  @Volatile private var running = false
  private var worker: Thread? = null

  @SuppressLint("MissingPermission") // RECORD_AUDIO is requested by the app before any listening starts
  fun start(emit: (event: String, payload: Map<String, Any?>) -> Unit) {
    stop()
    running = true
    worker = thread(name = "CueAudioCapture") {
      val bufferBytes = maxOf(
        AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT),
        FRAME_SAMPLES * 2 * 8,
      )
      val record = AudioRecord(
        MediaRecorder.AudioSource.VOICE_RECOGNITION,
        SAMPLE_RATE,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
        bufferBytes,
      )
      if (record.state != AudioRecord.STATE_INITIALIZED) {
        record.release()
        emit("onAudioError", mapOf("message" to "mic unavailable"))
        return@thread
      }

      // Reported only after the mic is released, so the wake-word service restarting right behind us can't find it held.
      var result: Pair<String, Map<String, Any?>>? = null
      try {
        record.startRecording()
        val clip = ByteArrayOutputStream()
        val preRoll = ArrayDeque<ShortArray>()
        val frame = ShortArray(FRAME_SAMPLES)
        var noiseFloor = 0.0
        var calibrationFrames = 0
        var loudRun = 0
        var speaking = false
        var silentMs = 0
        var elapsedMs = 0

        while (running) {
          var filled = 0
          while (filled < FRAME_SAMPLES && running) {
            val n = record.read(frame, filled, FRAME_SAMPLES - filled)
            if (n <= 0) break
            filled += n
          }
          if (filled < FRAME_SAMPLES) break
          elapsedMs += FRAME_MS

          var sum = 0.0
          for (s in frame) sum += s.toDouble() * s
          val rms = sqrt(sum / FRAME_SAMPLES)

          // The first 200 ms measure the room, so the speech threshold adapts to a quiet room or a noisy one.
          if (calibrationFrames < 10) {
            noiseFloor += rms / 10
            calibrationFrames++
          }
          val threshold = maxOf(noiseFloor * 3.0, MIN_SPEECH_RMS)
          val quietThreshold = maxOf(noiseFloor * 2.0, MIN_QUIET_RMS)
          val copy = frame.copyOf()

          if (!speaking) {
            preRoll.addLast(copy)
            if (preRoll.size > PRE_ROLL_FRAMES) preRoll.removeFirst()
            loudRun = if (rms > threshold) loudRun + 1 else 0
            if (loudRun >= SPEECH_START_FRAMES) {
              speaking = true
              preRoll.forEach { clip.write(toBytes(it)) }
              preRoll.clear()
              silentMs = 0
            } else if (elapsedMs >= NO_SPEECH_MS) {
              result = "onAudioError" to mapOf("message" to "nospeech")
              break
            }
          } else {
            clip.write(toBytes(copy))
            silentMs = if (rms < quietThreshold) silentMs + FRAME_MS else 0
            if (silentMs >= END_SILENCE_MS || elapsedMs >= MAX_CLIP_MS) {
              result = "onAudioCaptured" to mapOf("wav" to Base64.encodeToString(toWav(clip.toByteArray()), Base64.NO_WRAP))
              break
            }
          }
        }
      } catch (e: Exception) {
        Log.w("CueAudioCapture", "capture failed", e)
        if (running) result = "onAudioError" to mapOf("message" to (e.message ?: "capture failed"))
      } finally {
        try {
          record.stop()
        } catch (_: IllegalStateException) {
        }
        record.release()
      }
      val wasRunning = running
      running = false
      // A stop() from the app (cancelled) reports nothing; otherwise the clip, or why there isn't one.
      if (wasRunning) {
        val (event, payload) = result ?: ("onAudioError" to mapOf("message" to "capture ended early"))
        emit(event, payload)
      }
    }
  }

  fun stop() {
    running = false
    worker?.join(300)
    worker = null
  }

  private fun toBytes(samples: ShortArray): ByteArray {
    val buffer = ByteBuffer.allocate(samples.size * 2).order(ByteOrder.LITTLE_ENDIAN)
    samples.forEach { buffer.putShort(it) }
    return buffer.array()
  }

  private fun toWav(pcm: ByteArray): ByteArray {
    val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
    header.put("RIFF".toByteArray()).putInt(36 + pcm.size).put("WAVE".toByteArray())
    header.put("fmt ".toByteArray()).putInt(16).putShort(1).putShort(1)
    header.putInt(SAMPLE_RATE).putInt(SAMPLE_RATE * 2).putShort(2).putShort(16)
    header.put("data".toByteArray()).putInt(pcm.size)
    return header.array() + pcm
  }
}
