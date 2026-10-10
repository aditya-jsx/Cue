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
  private const val MAX_CLIP_MS = 12_000
  private const val NO_SPEECH_MS = 6_000
  private const val END_SILENCE_MS = 1_500 // a natural pause mid-sentence; 2 s felt slow to end
  private const val SPEECH_START_FRAMES = 3
  private const val MIN_SPEECH_RMS = 600.0
  private const val MAX_NOISE_FLOOR = 800.0 // a calibration that caught speech would otherwise make speech count as silence
  private const val MIN_QUIET_RMS = 300.0
  private const val OVER_CHIME_FRAMES = 100 // 2 s, longer than the chime
  private const val OVER_CHIME_GRACE_MS = 1_500 // speech starting this soon after the chime may have begun over it
  private const val MIN_VOICED_MS = 250 // shorter than any word: a sound this brief that's followed by quiet isn't speech // below this counts as silence; lower than the start level so soft words aren't cut off

  @Volatile private var running = false
  private var worker: Thread? = null

  @SuppressLint("MissingPermission") // RECORD_AUDIO is requested by the app before any listening starts
  /**
   * `fixedMs` > 0 records exactly that long (after the chime) instead of waiting for the speaker to stop: for a one-word
   * answer ("approve"), which is too short and quiet for end-of-speech detection to catch reliably.
   */
  fun start(fixedMs: Int = 0, emit: (event: String, payload: Map<String, Any?>) -> Unit) {
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
        var voicedMs = 0
        var recordedMs = 0
        var heardSomething = false
        val overChime = ArrayDeque<ShortArray>()
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

          // Cue's own chime is still playing: it mustn't set the room level or count as speech, but someone who talks
          // straight after "Hey Cue" is talking over it, so the audio is kept to go in front of the clip.
          if (System.currentTimeMillis() < CueWakeWordBus.chimeUntil) {
            overChime.addLast(frame.copyOf())
            if (overChime.size > OVER_CHIME_FRAMES) overChime.removeFirst()
            continue
          }
          recordedMs += FRAME_MS

          // The first 200 ms measure the room, so the speech threshold adapts to a quiet room or a noisy one. The
          // quietest frame, not the average: the user may already be talking.
          if (calibrationFrames < 10) {
            noiseFloor = if (calibrationFrames == 0) rms else minOf(noiseFloor, rms)
            if (++calibrationFrames == 10) noiseFloor = minOf(noiseFloor, MAX_NOISE_FLOOR)
          }
          val threshold = maxOf(noiseFloor * 3.0, MIN_SPEECH_RMS)
          val quietThreshold = maxOf(noiseFloor * 1.5, MIN_QUIET_RMS) // quiet syllables mid-sentence aren't silence
          val copy = frame.copyOf()

          if (fixedMs > 0) {
            if (overChime.isNotEmpty()) {
              overChime.forEach { clip.write(toBytes(it)) }
              overChime.clear()
            }
            clip.write(toBytes(copy))
            if (rms > threshold) heardSomething = true
            if (recordedMs >= fixedMs) {
              Log.d("CueAudioCapture", "fixed ${fixedMs}ms window, heard something: $heardSomething")
              result = if (heardSomething) {
                "onAudioCaptured" to mapOf("wav" to Base64.encodeToString(toWav(clip.toByteArray()), Base64.NO_WRAP))
              } else {
                "onAudioError" to mapOf("message" to "nospeech")
              }
              break
            }
            continue
          }

          if (!speaking) {
            preRoll.addLast(copy)
            if (preRoll.size > PRE_ROLL_FRAMES) preRoll.removeFirst()
            loudRun = if (rms > threshold) loudRun + 1 else 0
            if (loudRun >= SPEECH_START_FRAMES) {
              speaking = true
              Log.d("CueAudioCapture", "speech start at ${elapsedMs}ms rms=${rms.toInt()} threshold=${threshold.toInt()}")
              // Talking began right as the chime ended: the start of the sentence was said over it.
              if (recordedMs <= OVER_CHIME_GRACE_MS) overChime.forEach { clip.write(toBytes(it)) }
              overChime.clear()
              preRoll.forEach { clip.write(toBytes(it)) }
              preRoll.clear()
              silentMs = 0
              voicedMs = 0
            } else if (elapsedMs >= NO_SPEECH_MS) {
              result = "onAudioError" to mapOf("message" to "nospeech")
              break
            }
          } else {
            clip.write(toBytes(copy))
            silentMs = if (rms < quietThreshold) silentMs + FRAME_MS else 0
            if (rms >= quietThreshold) voicedMs += FRAME_MS
            if (silentMs >= END_SILENCE_MS && voicedMs < MIN_VOICED_MS && elapsedMs < NO_SPEECH_MS) {
              // A blip (the chime's echo, a tap), not speech: forget it and keep waiting for the user to talk.
              Log.d("CueAudioCapture", "ignored a ${voicedMs}ms blip at ${elapsedMs}ms")
              speaking = false
              loudRun = 0
              clip.reset()
              continue
            }
            if (silentMs >= END_SILENCE_MS || elapsedMs >= MAX_CLIP_MS) {
              Log.d("CueAudioCapture", "speech end at ${elapsedMs}ms, ${voicedMs}ms voiced")
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
