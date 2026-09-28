package expo.modules.cuenative

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import java.nio.FloatBuffer

/**
 * Ports openWakeWord's streaming feature pipeline (raw audio -> melspectrogram -> speech
 * embedding -> classifier) to Kotlin/ONNX Runtime, frame-for-frame matching
 * `openwakeword.utils.AudioFeatures._streaming_features` so the "Hey Cue" model — trained
 * against that exact pipeline — scores real-time mic audio the same way it saw training data.
 *
 * Feed consecutive 1280-sample (80ms) chunks of 16kHz mono PCM via [processChunk]. Returns null
 * until enough history has accumulated to run the classifier (~1.5-2s of audio).
 */
class WakeWordDetector(context: Context) {
  private val env = OrtEnvironment.getEnvironment()
  private val melspecSession: OrtSession
  private val embeddingSession: OrtSession
  private val classifierSession: OrtSession
  private val melspecInputName: String
  private val embeddingInputName: String
  private val classifierInputName: String

  // Raw PCM history: only ever need the last CHUNK_SAMPLES + MELSPEC_LOOKBACK samples per step.
  private var rawBuffer = ShortArray(0)
  // Mel frames (each 32 bins): only ever need the last MEL_WINDOW frames per step.
  private var melBuffer: Array<FloatArray> = arrayOf()
  // Embedding vectors (each 96-dim): only ever need the last EMBED_WINDOW vectors per step.
  private var embedBuffer: Array<FloatArray> = arrayOf()

  init {
    fun loadAsset(name: String) = context.assets.open(name).use { it.readBytes() }
    val opts = OrtSession.SessionOptions()
    melspecSession = env.createSession(loadAsset("melspectrogram.onnx"), opts)
    embeddingSession = env.createSession(loadAsset("embedding_model.onnx"), opts)
    classifierSession = env.createSession(loadAsset("hey_cue.onnx"), opts)
    melspecInputName = melspecSession.inputNames.first()
    embeddingInputName = embeddingSession.inputNames.first()
    classifierInputName = classifierSession.inputNames.first()
  }

  fun processChunk(chunk: ShortArray): Float? {
    require(chunk.size == CHUNK_SAMPLES) { "processChunk requires exactly $CHUNK_SAMPLES samples (80ms @ 16kHz)" }

    rawBuffer = trim(rawBuffer + chunk, MAX_RAW)

    val melInputStart = maxOf(0, rawBuffer.size - (CHUNK_SAMPLES + MELSPEC_LOOKBACK))
    val newMelFrames = runMelspec(rawBuffer.copyOfRange(melInputStart, rawBuffer.size))
    melBuffer = trim(melBuffer + newMelFrames, MAX_MEL)

    if (melBuffer.size >= MEL_WINDOW) {
      val window = melBuffer.copyOfRange(melBuffer.size - MEL_WINDOW, melBuffer.size)
      embedBuffer = trim(embedBuffer + arrayOf(runEmbedding(window)), MAX_EMBED)
    }

    if (embedBuffer.size < EMBED_WINDOW) return null
    val window = embedBuffer.copyOfRange(embedBuffer.size - EMBED_WINDOW, embedBuffer.size)
    return runClassifier(window)
  }

  private fun runMelspec(samples: ShortArray): Array<FloatArray> {
    val floatData = FloatArray(samples.size) { samples[it].toFloat() }
    OnnxTensor.createTensor(env, FloatBuffer.wrap(floatData), longArrayOf(1, samples.size.toLong())).use { input ->
      melspecSession.run(mapOf(melspecInputName to input)).use { results ->
        @Suppress("UNCHECKED_CAST")
        val raw = results[0].value as Array<Array<Array<FloatArray>>> // (1, 1, frames, 32)
        return raw[0][0].map { frame -> FloatArray(frame.size) { frame[it] / 10f + 2f } }.toTypedArray()
      }
    }
  }

  private fun runEmbedding(melWindow: Array<FloatArray>): FloatArray {
    val floatData = FloatArray(MEL_WINDOW * MEL_BINS)
    for (t in 0 until MEL_WINDOW) {
      for (b in 0 until MEL_BINS) floatData[t * MEL_BINS + b] = melWindow[t][b]
    }
    OnnxTensor.createTensor(env, FloatBuffer.wrap(floatData), longArrayOf(1, MEL_WINDOW.toLong(), MEL_BINS.toLong(), 1)).use { input ->
      embeddingSession.run(mapOf(embeddingInputName to input)).use { results ->
        @Suppress("UNCHECKED_CAST")
        val raw = results[0].value as Array<Array<Array<FloatArray>>> // (1, 1, 1, 96)
        return raw[0][0][0]
      }
    }
  }

  private fun runClassifier(embedWindow: Array<FloatArray>): Float {
    val floatData = FloatArray(EMBED_WINDOW * EMBED_DIM)
    for (t in 0 until EMBED_WINDOW) {
      for (d in 0 until EMBED_DIM) floatData[t * EMBED_DIM + d] = embedWindow[t][d]
    }
    OnnxTensor.createTensor(env, FloatBuffer.wrap(floatData), longArrayOf(1, EMBED_WINDOW.toLong(), EMBED_DIM.toLong())).use { input ->
      classifierSession.run(mapOf(classifierInputName to input)).use { results ->
        @Suppress("UNCHECKED_CAST")
        val raw = results[0].value as Array<FloatArray> // (1, 1)
        return raw[0][0]
      }
    }
  }

  private fun trim(arr: ShortArray, max: Int) = if (arr.size > max) arr.copyOfRange(arr.size - max, arr.size) else arr
  private fun trim(arr: Array<FloatArray>, max: Int) = if (arr.size > max) arr.copyOfRange(arr.size - max, arr.size) else arr

  fun close() {
    melspecSession.close()
    embeddingSession.close()
    classifierSession.close()
  }

  companion object {
    const val CHUNK_SAMPLES = 1280 // 80ms @ 16kHz — the engine's step size
    private const val MELSPEC_LOOKBACK = 160 * 3 // extra samples the melspec model needs for windowing
    private const val MEL_BINS = 32
    private const val MEL_WINDOW = 76 // mel frames per embedding step
    private const val EMBED_DIM = 96
    private const val EMBED_WINDOW = 16 // embedding frames per classifier step (~1.28s)
    private const val MAX_RAW = CHUNK_SAMPLES + MELSPEC_LOOKBACK
    private const val MAX_MEL = MEL_WINDOW + 8 // a little headroom past one step's worth of new frames
    private const val MAX_EMBED = EMBED_WINDOW + 2
  }
}
