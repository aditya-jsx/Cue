package expo.modules.cuenative

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer

/**
 * Wraps Android's built-in SpeechRecognizer (system STT, no API key, no network dependency we own)
 * for tap-to-talk. SpeechRecognizer must be created and driven from the main thread.
 */
object SpeechRecognitionBridge {
  private var recognizer: SpeechRecognizer? = null
  private val main = Handler(Looper.getMainLooper())

  fun start(context: Context, hints: List<String>, emit: (event: String, payload: Map<String, Any?>) -> Unit) {
    main.post {
      stopInternal()
      if (!SpeechRecognizer.isRecognitionAvailable(context)) {
        emit("onSpeechError", mapOf("message" to "Speech recognition isn't available on this device"))
        return@post
      }
      val r = SpeechRecognizer.createSpeechRecognizer(context)
      recognizer = r
      r.setRecognitionListener(object : RecognitionListener {
        override fun onPartialResults(partial: Bundle) {
          partial.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.let {
            emit("onSpeechPartial", mapOf("text" to it))
          }
        }

        override fun onResults(results: Bundle) {
          val text = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: ""
          emit("onSpeechResult", mapOf("text" to text))
          // Destroy now — otherwise this recognizer lingers and later errors ("not connected to the
          // recognition service") once the wake-word service reclaims the mic, firing a stray onError.
          main.post { stopInternal() }
        }

        override fun onError(error: Int) {
          emit("onSpeechError", mapOf("message" to "recognition error ($error)"))
          main.post { stopInternal() }
        }

        override fun onReadyForSpeech(params: Bundle?) = Unit
        override fun onBeginningOfSpeech() = Unit
        override fun onRmsChanged(rmsdB: Float) = Unit
        override fun onBufferReceived(buffer: ByteArray?) = Unit
        override fun onEndOfSpeech() = Unit
        override fun onEvent(eventType: Int, params: Bundle?) = Unit
      })
      r.startListening(
        Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
          putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
          putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
          putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
          // Cue's vocabulary (token names, contacts) — otherwise "JUP" comes back as "June", "buy" as "by".
          if (Build.VERSION.SDK_INT >= 33 && hints.isNotEmpty()) {
            putStringArrayListExtra(RecognizerIntent.EXTRA_BIASING_STRINGS, ArrayList(hints))
          }
        },
      )
    }
  }

  fun stop() {
    main.post { stopInternal() }
  }

  private fun stopInternal() {
    recognizer?.apply {
      stopListening()
      destroy()
    }
    recognizer = null
  }
}
